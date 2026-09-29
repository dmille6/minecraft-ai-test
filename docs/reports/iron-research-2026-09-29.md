# Iron: how to get it — two-engine research, 2026-09-29

Owner: "how do humans in the game find iron better than our current approaches... lets try to think of a novel way". Both engines independently, from the 1.21.11 worldgen data, the wiki/community, Baritone source, our code (80b3bbd) and a fleet export (NOTE: the export covered 2 h 15 min, not 24 h — logs rotated at midnight).

## Key fact
Paper anti-xray is DISABLED on all 16 worlds (verified on the worlds host): the bots know every ore block in loaded chunks. All 80 bots had iron within 40 blocks; nearest iron median 15 blocks (p90 24).

## Codex (ChatGPT) report, verbatim

**Recommendation: make iron gathering a planned round trip to known ore, scored by excavation cost and collected yield.** Your anti-xray verification makes discovery unnecessary inside loaded chunks. Superiority remains a hypothesis: [Baritone already targets buried ore](https://github.com/cabaletta/baritone/blob/master/src/main/java/baritone/process/MineProcess.java), with exposure-only filtering optional.

**Verified human strategies.** Java 1.21.11’s generation settings are:

| Batch | Attempts/chunk | Y distribution | Configured size |
|---|---:|---|---:|
| [Upper](https://mcasset.cloud/1.21.11/data/minecraft/worldgen/placed_feature/ore_iron_upper.json) | 90 | 80–384, peak 232 | 9 |
| [Middle](https://mcasset.cloud/1.21.11/data/minecraft/worldgen/placed_feature/ore_iron_middle.json) | 10 | −24–56, peak 16 | 9 |
| [Small](https://raw.githubusercontent.com/misode/mcmeta/1.21.11-data/data/minecraft/worldgen/placed_feature/ore_iron_small.json) | 10 | Uniform −64–72 | 4 |

These are placement attempts and size parameters, not guaranteed ore counts. Both [normal](https://mcasset.cloud/1.21.11/data/minecraft/worldgen/configured_feature/ore_iron.json) and [small](https://raw.githubusercontent.com/misode/mcmeta/1.21.11-data/data/minecraft/worldgen/configured_feature/ore_iron_small.json) features have **zero air-exposure discard**. Thus exposed mountain stone near Y232 and underground stone near Y16 are sensible human search areas. [Cheese caverns, spaghetti tunnels and noodle caves](https://feedback.minecraft.net/hc/en-us/articles/4415128577293-Minecraft-Java-Edition-1-18) provide naturally excavated faces.

Large iron veins contain deepslate iron, tuff and raw-iron blocks at Y−60…−8 ([generation code](https://raw.githubusercontent.com/mahtomedi/minecraft/main/src/main/java/net/minecraft/world/level/levelgen/OreVeinifier.java)). Reddit’s useful observation is to [follow iron-bearing tuff across gaps](https://www.reddit.com/r/Minecraft/comments/11dsiel/); reported enormous yields are anecdotes, not expected returns.

Branch mining reduces excavation relative to clearing entire layers. **Geometric calculation:** extending an isolated 1×2 tunnel breaks two blocks and reveals six new side/floor/ceiling blocks; 1×1 crawling reveals four per block. Wider branch spacing reduces repeated inspection but misses deposits. These are exposure yields; I found no defensible controlled **1.21 iron-per-block** benchmark.

Other routes:

- Village [armorer](https://raw.githubusercontent.com/misode/mcmeta/1.21.11-data/data/minecraft/loot_table/chests/village/village_armorer.json), [weaponsmith](https://raw.githubusercontent.com/misode/mcmeta/1.21.11-data/data/minecraft/loot_table/chests/village/village_weaponsmith.json) and [toolsmith](https://raw.githubusercontent.com/misode/mcmeta/1.21.11-data/data/minecraft/loot_table/chests/village/village_toolsmith.json) chests can contain ingots.
- [Shipwreck treasure](https://raw.githubusercontent.com/misode/mcmeta/1.21.11-data/data/minecraft/loot_table/chests/shipwreck_treasure.json) supplies ingots/nuggets; [ruined portals](https://raw.githubusercontent.com/misode/mcmeta/1.21.11-data/data/minecraft/loot_table/chests/ruined_portal.json) supply iron nuggets.
- [Golems drop 3–5 ingots](https://raw.githubusercontent.com/misode/mcmeta/1.21.11-data/data/minecraft/loot_table/entities/iron_golem.json). [Speedrunners](https://github.com/Metacor/Minecraft-Speedrun-Guide) exploit villages, shipwrecks and treasure’s chunk-local 9,9 position.
- [Trading](https://raw.githubusercontent.com/mahtomedi/minecraft/main/src/main/java/net/minecraft/world/entity/npc/VillagerTrades.java) supplies iron equipment; smiths buy ingots rather than sell them.

**Verified fleet findings.** Two corrections matter:

1. [Perception stores rounded nearest-block distances](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/state.mjs:87), **not counts**, and omits deepslate iron.
2. The supplied [dataset](/private/tmp/claude-501/-Users-darrellmiller-Documents-code-minecraft-ai/5e1eb303-d6eb-439f-b2db-6324abd0a58f/scratchpad/data/fleet-iron-24h.jsonl.gz) spans **September 28 23:58–September 29 02:13 UTC**, approximately 2¼ hours, despite its filename.

Across its 8,356 iron observations/all 80 bots, distance p50/p90 is **15/24 blocks**; bot-Y p50 is 65. There are 168 iron gathers, one success, 101 buried failures and 102 escalations. The supplied 24-hour figures—555 buried, 6.4% success, 1,059 escalations—are earlier findings, not reproduced by this file.

The mechanism is explicit:

- Gather examines at most 32 candidates, then [filters by exposure and safety](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:1485). Fully enclosed ore never reaches `collectManually`.
- [Escalation passes only Y](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:1734); `mine` chooses a dry cardinal staircase, ignoring ore X/Z.
- Manual collection first walks with `canDig=false`; its [dig retry](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:1074) permits **16 breaks, 400 cost-slack, 2s planning, 15s execution**, and rejects unaffordable/destructive plans ([limits](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/digapproach.mjs:77)). Liquid/falling-block vetoes further restrict excavation.
- [“Iron in reach”](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/milestones.mjs:422) merely finds iron within 32 blocks.

Escalation details reveal selected ore Y=25–68, median 58. General ore depth, exposure and tunnel length remain unknown. Add one structured field: `iron_candidates:[{xyz,exposed_faces,standable,loaded,min_route_digs}]`, covering both ore variants.

**Proposed design—not yet validated.**

Use one deterministic gather subroutine:

1. Enumerate known iron within 40 blocks; rank feasible trips by `(travel + digging + pickup + return time)/recoverable iron`. Prefer connected exposed stances when cheaper.
2. Search a bounded graph of two-block-high stances, retaining excavation, tool wear and exit resources. Reject lava breaches, unsupported gravel and unknown cells. Water crossings remain travel; opening a flooded tunnel requires separate air/egress feasibility.
3. Execute explicit 1×2 corridors and reversible stairs to a verified exit; revalidate before every break. Preserve home protections. Use ordinary survival actions only.
4. Harvest the whole affordable cluster, including nearby disconnected pockets, then collect and return; reserve limits override cluster completion. Coordinate claims between bots.
5. Preserve [exit-contract reserves](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/exit-contract.mjs:145), plus actual return-route requirements. At Y48: 23 scaffold and 29 remaining uses. A stone pick has 131 nominal uses, 130 conservatively available. Price the actual [tool policy](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/toolfor.mjs:48).
6. Compose with [last-swing and hygiene](/Users/darrellmiller/Documents/code-minecraft-ai/docs/reports/STATE.md:274): bootstrap replacement picks before departure; reserve pickup slots; never spend emergency durability on speculative tunnelling.

The proposed advantage is **yield-aware extraction with a verified return**, not novel ore detection.

**Estimate and proof.** Observed proximity supports short-tunnel experiments, not a fleet uplift forecast. Conditional example: 15 horizontal metres through stone plus eight ore costs roughly 38 breaks: **0.21 raw iron/break**, leaving 92 conservative stone-pick uses. Vertical routes, hazards and isolated ore can erase that advantage.

Sandbox natural terrain with buried clusters, caves, lava, gravel, depleted tools, full inventories and competing bots; compare collected-and-returned iron against baseline. Risks include stale chunks, fluid updates, planner explosion and pickup failure.

Then randomize **20 bots across four whole worlds**, with 60 controls; freeze last-swing/hygiene identically. Read at 6h, extend to 26h if inconclusive. Use matched pre/post **DiD**, clustered by world: returned iron/bot-hour and three-ingot attainment; monitor deaths, entombment, tool exhaustion and CPU. No edits or deployments performed.

## Claude report (condensed; sources read directly)
- 1.21.11 worldgen: ore_iron_upper 90/chunk y80-384 peak 232 (mountains); ore_iron_middle 10/chunk y-24..56 peak 16; ore_iron_small 10/chunk uniform -64..72; **iron's discard_chance_on_air_exposure = 0.0** (cave faces show it); iron veins y -8..-60 (thickest -40..-28), tuff + ore, 2% raw_iron blocks.
- Humans: caving (most ore per time), exposed mountain faces, 1x2 strip mining 3-5 apart, never dig straight down, carry blocks; loot: buried treasure 1-4 ingots at 99.4%, shipwreck treasure 1-5 at 97.4%, village armorer 1-3 at 54.2%.
- **Not novel: Baritone's MineProcess already targets all known ore positions (legitMine=false) and A*-prices breaks.** Our design is a port with our safety rules, exit contract, cluster mining and determinism.
- Why ours fails: gather requires an air face (isExposed, skills.mjs:5137) so buried ore never reaches the dig-approach planner; the planner is capped (16 breaks, 15 s); the escalation passes only y (skills.mjs:1734) and `mine` stairs toward dryness, down only. Window: 168 iron gathers, 1 success. **The binding constraint is the pickaxe**: 259 of 285 pickaxe refusals had 0 swings; 66/80 held no usable stone+ pickaxe (last-swing addresses it).
- deepslate_iron_ore is invisible to the model (missing from INTERESTING_BLOCKS prompt.mjs:42 and perception state.mjs:87).
- Design: A* with GoalCompositeAny over all iron within 24; hazard mask (no lava/water on any of 6 faces, falling-block rule); budget pickaxe uses >= breaks + cluster + exit reserve, refuse with an executable remedy; flood-fill the cluster; deterministic when gather says "buried". Needs last-swing and hygiene first.
- Estimate: per-attempt success ~1.7% -> ~30% (0.61 within 16 x 0.7 safe path x 0.7 execution); bots with raw iron 22-25 -> 35+; one stone pick ~4 trips. Risks: lava (41% of rows have lava within 40), flooding, pickaxe exhaustion, A* blow-up.
- Sandbox fixtures: hillside ore, ore 10 down, lava beside the shortest path, water overhead, gravel ceiling, a 20-use pick vs a 26-break plan; control must say "every candidate is buried".
- Log first (cheap): iron_near:[[dx,dy,dz,airFaces,lavaWithin2,plannedBreaks]] for the 8 nearest ores.
