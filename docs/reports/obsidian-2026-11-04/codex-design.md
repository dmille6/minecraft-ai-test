**Recommend a request-driven deep-miner extension: prefer safe natural obsidian outside protected zones; otherwise cast at depth in a fully contained cell. Do not carry lava to town in the first version.** This is a design only; no files were edited or new proofs run.

1. **Where the four blocks come from**

   The measured surface search is exhausted within the surveyed volume. Lava occurred in only **0.060%** of affordance scans (76/125,879), so opportunistic surface gathering is not a credible supply plan.

   Natural obsidian avoids bucket operations, but **both supplied nearest targets are forbidden**: `(78,-55,69)` and `(56,-55,89)` lie inside the trial-chambers box `[-20,-64,65]..[88,31,164]`. Its protection extends below the chamber floor. Survey the remaining 78-block population against zones before selecting any target; neither proximity nor natural generation grants permission. See [protected zones](/Users/darrellmiller/Documents/.wt-enchantshop/infra/showcase/protected-zones.showcase.json).

   Use the existing stair to feet **16**, then the miner’s **69-block descent to feet -53**. Obsidian at -55 sits below that route’s floor: ordinary branch mining will not collect it safely. Require a purpose-built side work bay with verified access, containment and retrieval footing.

   If no safe natural target exists, find **four accessible lava sources**, preferably near the upper lake boundary, and cast individually. The nearest measured lava at `(-37,-62,-40)` is a survey lead, not an approved destination. Do not lower the general mining floor to reach it.

   Each successful cast consumes **one lava source**; **one water bucket is reusable**. Four measured digs require **300 seconds minimum**, excluding travel and construction. If a diamond pick must be crafted, town diamonds become `18 − 3 − 2 = 13` after pick and table, comfortably above the fitter’s three-diamond reserve. See `PICK_DIAMONDS`, `DEEP_FEET` in [deepmine.mjs](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/deepmine.mjs), and `fitAvail`/recipe definitions in [enchantshop.mjs](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/enchantshop.mjs).

   Carrying lava upstairs adds lava-source scooping, transport and placement semantics that `bucket.mjs` does not provide. With one bucket per bot, surface casting also requires a second bucket or coordinated water carrier. It still requires four source collections. Defer it.

2. **Safety contract**

   Preserve ordinary `deepBranch` liquid refusals. Add a narrowly scoped casting operation; never globally permit digging beside liquids.

   Before opening a target, verify loaded geometry, zone clearance, solid retrieval floor, lateral barriers, dry standing space, headroom and a return route. Unknown backing is refusal. Natural obsidian may cap lava: “already obsidian” is not evidence that breaking it is safe.

   For casting, reproduce the proven **1×1 contained hole**, with the source one below the surrounding floor. Verify containment before pouring; verify obsidian and bucket inventory afterward; recover the water **before digging**. Failed recovery leaves the site contained and unavailable for harvesting.

   Dig from an adjacent dry, grounded stand with a verified diamond pick. Keep lava, drowning and movement reflexes active. Never break the bot’s supporting block or enter an unmeasured drop.

   Use one harvest per skill call. `deepMine` currently has a **140-second internal budget**, inside the 180-second runner cut. Proposed admission: start a dig only with **125 seconds remaining**, allocating at most 95 seconds for the measured 75-second dig and 30 seconds for retrieval/egress. Validate those margins in Paper. Do not raise general escape limits: `planDig`’s 30-second cap serves a different purpose. Audit the harvest path’s shorter dig wrappers and `watchDigging`. See [skills.mjs](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/skills.mjs) and [digbudget.mjs](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/digbudget.mjs).

   Prebuild the collection step and climb out. Enter only after confirming a dry, supported pocket; count success from **inventory increase**, then climb, verify footing and close the hole. Cancellation must stop digging/movement and leave a recoverable state.

3. **Deep-miner and requests composition**

   Extend `bot.deepTrip` with an obsidian target and resumable phases: survey → prepare → cast/recover-water → harvest → retrieve/exit → return → bank. Natural targets skip casting. Reuse the **single town miner lease**, trail, stair credit, health/tool/block reserves and return limits. Do not launch an independent lava expedition alongside it.

   In [requests.mjs](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/requests.mjs), `eventFor` already maps `_enchantshop_gate` to `enchant_table` demand. However, production and deposit attribution currently recognize copper. Add obsidian-specific production and verified deposit events.

   The board remains evidence, not a command channel. A deterministic dispatcher rechecks actual shortage, kit, site and lease before starting. Reserve in-flight cargo against the four-block deficit; stop new harvesting when demand disappears. Bank verified inventory through `town_deposit`; let a fresh furnishing gate close the request. A broken block is neither a fill nor a completed table.

4. **Pieces, tiers and lanes**

   | Piece | Tier and route |
   |---|---|
   | Survey/report of legal natural targets | Tier 1, read-only |
   | Fix both bucket aim adapters to supply `Vec3` | Tier 3: Paper, two engines, fleet canary |
   | Contained harvesting and deep-miner integration | Tier 3: Paper, two engines, fleet canary |
   | Board attribution and showcase activation | Tier 2 outside protected scope; showcase first after dependencies KEEP |

   Follow [protected-paths.txt](/Users/darrellmiller/Documents/.wt-enchantshop/config/protected-paths.txt) and [process tiers](/Users/darrellmiller/Documents/.wt-enchantshop/docs/PROCESS-fun-mode.md). Moving mining logic into a new file does not make its risk tier 2.

   Reconcile “showcase only” as **production enablement only on showcase**, while shared protected code passes fleet canary and KEEP. Keep acquisition disabled in fleet pools; sandbox exercises the active path. An unexposed fleet KEEP is explicitly **goal unverified**, not proof of harvesting. Showcase activation must preserve protected-code equality with the **latest** fleet KEEP. If active fleet acquisition is required for validation, that conflicts with the owner’s restriction and needs a specific exception.

5. **First shippable piece**

   Ship the narrow **bucket `Vec3` fix** first, through tier 3. It repairs an established failure and enables the contained-cast primitive without changing lava-scooping policy. Existing dormant callers may begin working, so their effects need regression coverage. It does not itself deliver obsidian.

6. **Remaining Paper proof**

   Prove the integrated bot—not only the fixture—can find an allowed site, construct containment, harvest four blocks, recover water, collect drops, climb out, return, bank and trigger table placement. Include unsafe backing, flowing lava, unknown chunks, lost lease, restart, inventory-full, tool failure, interrupted dig and reflex preemption.

   Verify timeouts accommodate 75 seconds without weakening escape budgets; prove no spread into the shaft or adjacent cells. Finally verify the actual fitted workshop still offers **30**, with its one-block bookshelf gap clear.
done
