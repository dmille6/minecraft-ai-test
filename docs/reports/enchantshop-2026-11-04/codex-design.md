**Build X1 as a usable shell first, then install independently funded furnishings. Leather production—not diamonds, lapis, or the building—is the critical dependency.**

Read-only review; no files changed. The referenced wall-extension, farms, trading, anvil-proof reports and copper-hall generator are absent from this checkout. Their facts below come from your brief; implementation references come from inspected code.

**Building and layout**

Use the full **19 × 13 pad**, x −22…−4, z −65…−53. Survey before fixing the floor at **y=63**; fill shallow low spots, and refuse unexpected cavities or foreign structures.

Follow the setback walls, stone course, spruce upper walls, glass bays, stone eaves and plank roof in [storehub’s generator](/Users/darrellmiller/Documents/.wt-enchantshop/docs/reports/storehub-ab-2026-11-04/make_storehub.py) and `hall@1.json`:

- Walls: x −21…−5, z −64…−54; interior **15 × 9**.
- South-facing, three-wide entrance at x −14…−12, z −54, toward storage. Preserve the intervening access corridor.
- Floor y=63; furnishings y=64; roof y=66. Keep two-block walking clearance.
- Enchanting table: **(−17,64,−60)**.
- Fifteen ordinary bookshelves: the perimeter of x −19…−15, z −62…−58 at y=64, **except (−17,64,−58)**, which is the entrance.
- Anvil: **(−9,64,−60)** on permanent support, with clear operator space south and west.
- Book chest: **(−7,64,−62)**, lid clear; optional grindstone at **(−7,64,−58)**.
- Wall signs: entrance identity; beside anvil; beside chest showing table/shelf progress. Lights stay outside the enchanting gap.

The shelf rule is `max(abs(dx),abs(dz))=2`, at table height here. Keep the intervening 3 × 3 area, excluding the table, air at y=64–65: no torches, signs, carpets or temporary scaffolds. This gives fifteen valid shelves with one entrance. [Shelf geometry reference](https://minecraft.wiki/w/Enchantability)

A preliminary shell allowance is **350 cobblestone, 150 stone bricks, 240 spruce planks, 12 panes and 4 torches**, excluding unusual foundation work. Generate the exact bill before implementation. These quantities fit the measured stock; obtain planks from town logs rather than assuming builders’ bags are communal. Copper ornament can wait.

**Materials and production order**

| Furnishing | Requirement and present position | Bot production |
|---|---|---|
| Book chest and signs | Chest: 8 planks. One sign craft: 6 planks + 1 stick → 3 signs. Available today. | Existing `craft`, blueprint placement, and storage-label pattern. |
| Anvil | **31 town iron**; 197 measured leaves **166**. Available today, subject to fresh reservations. | Craft 3 iron blocks, then anvil; install after shell completion. |
| Enchanting table | **1 book, 2 diamonds, 4 obsidian**. Diamonds available; book and obsidian missing. | Reserve first produced book; new obsidian job; existing `craft`. |
| Fifteen bookshelves | **45 books + 90 planks** = **135 paper + 45 leather**. Wood available; books absent. | Produce and install one shelf per three books, incrementally. |
| Optional grindstone | 2 sticks, 1 stone slab, 2 planks. Available inputs. | Craft slab batch from 3 stone → 6 slabs; use one. |
| Lectern | Adds one bookshelf and 4 wooden slabs. | Defer: the chest avoids spending another **3 leather + 9 paper + 6 planks**, plus slabs. |

Table plus shelves require **46 leather and 138 paper**, hence **138 sugar cane**. The carried 61 cane can produce at most 60 paper, leaving one cane; even if all were released, another **77 cane** is needed. Actual shortfall is larger while planting stock remains reserved.

Concrete supply work:

1. **Cane:** existing `skills.mjs::parkGather` gathers plants for park demand and retains them for planting. It is not a paper supply chain. Add a leased surplus-harvest job: preserve planted bases and planting commitments, harvest upper cane, verify pickup, bank surplus, then craft paper in multiples of three. Do not silently consume the park pantry.
2. **Leather:** implement approved **pens-01 → herd-01 → leather-01**. Use `cropfarm` wheat, lure the known western cows, breed, wait for adults, and cull only verified surplus while retaining two breeders. Count actual leather pickups; do not equate cows killed with leather delivered. Trading is not an immediate substitute with zero employed villagers/offers.
3. **Obsidian:** reserve **3 additional diamonds + 2 sticks** for one shared diamond pickaxe. Total diamond commitment is **5 of 18**, leaving 13. Add a bounded survey-and-production job at a verified lava site: stable dry stands, contained water contacting lava sources, then mine and recover exactly four obsidian. Reuse an empty bucket for water; no new bucket iron is needed. Lava transport/casting is a separate fallback, not a prerequisite.

Current [bucket.mjs](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/bucket.mjs:71) explicitly refuses lava scooping. Owner permission therefore needs implementation and proof before lava buckets are usable.

Use existing `craft/craftLevel/craftExecutions` and iron replenishment through `smeltjob.mjs::ironSmeltCount/ironBankPlan`; add furnishing orchestration, not replacement crafting machinery.

**Records, requests and scheduling**

Create `enchantshop@1`, a shell project record, and child furnishing records: `anvil`, `table`, `shelves`, `book_store`, optionally `grindstone`. Each child records target cells, requested/installed quantity, remaining recipe inputs, reservations, holder/lease, generation and verified placement evidence.

Extend [requests.mjs](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/requests.mjs:66) `eventFor`, `reqKey` and `stepProject`. Today they recognize copper demand and copper deposits; emitting a new gate alone will not create requests.

Use **one parent request per furnishing**, with separately keyed ingredient deficits beneath it. Keep one shelves request with `installed=0…15`, rather than fifteen competing orders.

Example proposed telemetry:

```text
_enchantshop_gate furnishing=table item=obsidian need=4 have=0 short=4
_enchantshop_gate furnishing=shelves item=leather need=45 have=0 short=45
_enchantshop_place furnishing=shelves installed=1 target=15 verified=1
```

Journal lifecycle: `open → update/producing/fill → met`. Mark the furnishing **met only after observed placement**; ingredient readiness is a separate state. Record verified withdrawals, crafts, deposits and allocations without counting the same resources twice.

Freshness matters: copper’s “highest recent have” rule can overstate stock after consumption. Use current container observations plus durable reservations and held cargo; unknown stock stays unknown. Refresh waiting requests before their six-hour expiry. Replace the 16-unit update threshold for small furnishing demands, while retaining chat throttling.

Integrate through [shop.mjs](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/shop.mjs:133) `PROJECTS/activeProject` and `skills.mjs::buildShop`, using [buildrun.mjs::runVisit](/Users/darrellmiller/Documents/.wt-enchantshop/bots/src/buildrun.mjs:362) leases, acknowledgements and deadlines. Missing optional furnishings must not appear as shell damage or monopolize build visits.

Interpret construction order as **workshop shell → town-hall shell → new houses**, while workshop furnishings remain prioritized whenever ready. Make that milestone explicit; do not accidentally block town development on cattle maturation.

**Pieces and release lanes**

| Piece | Tier / lane |
|---|---|
| **First shippable: X1 shell, chest/signs, furnishing records and visible deficits** | **Tier 2, Paper → showcase building lane** |
| Anvil allocation/craft/install; table and incremental shelf installer | Tier 2, showcase crafting/building |
| Surplus cane harvest, paper/books pipeline; pens-01 | Tier 2, showcase farming |
| herd-01 and leather-01 | Tier 3, two review engines + fleet canary |
| Obsidian acquisition; lava-bucket support if needed | Tier 3, two engines + fleet canary |
| Town hall, then houses | Tier 2, showcase building |

Any protected-path change inherits tier 3 under [protected-paths.txt](/Users/darrellmiller/Documents/.wt-enchantshop/config/protected-paths.txt).

**Risks and required Paper proofs**

- **Iron starvation:** preserve bag kits; allocate only 31 freshly verified town ingots. Honor toolkit’s 16-ingot town reserve and existing commitments; serialize competing withdrawals. Never repeatedly rebuild a missing anvil automatically.
- **Construction traps:** prove entrance clearance, chest opening, shelf access, roof completion, builder departure, interrupted visits and restart recovery with two builders.
- **Resource loss:** prove recipe quantities, partial crafting recovery, allocation exclusivity and journal updates under simultaneous consumers.
- **Lava/death/world damage:** prove source-versus-flow detection, containment, dry retreat, correct pickaxe, pickup recovery, cancellation and water cleanup. Rare lava sightings are not guaranteed supply.
- **Farm damage:** prove cane-base preservation, herd containment, breeder protection and bounded unsuccessful trips.
- **Functional room:** verify all fifteen shelves contribute and the table offers the level-30 slot; verify anvil reach and window access. Applying books remains **anvilbooks-1103 step 2**, outside this design.

All construction and proofs use ordinary bot actions: no admin commands, teleportation, world edits or rails.
