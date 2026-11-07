# Flower supply and flower borders (flowers-01), 2026-11-07

Owner, 11-07 (~13:10Z): "yes, go ahead and start". The goal is towns that look like the target pictures in
[roughground-design-2026-11-07.md](roughground-design-2026-11-07.md) ("Look target"): lawns with flowers and tall grass
scattered on them, and paths edged with flowers. The bots get the flowers themselves. No admin edits.

**What was wrong:** all 61 live path-border cells on the showcase are ferns because the town has no flowers. The
problem is supply, not the border code.

## 1. Measured

Sources: telemetry.py full walks (main's `scripts/lib`, shipped to the host), the town index, the decor record, and
a census of the live map's region files. Every zero below has a positive control or a stated denominator.

| What | Showcase (.40, 15 bots, taiga town at 0,70,0) | Fleet (.31, 80 bots) |
|---|---|---|
| Decor border cells | 65 cells in 5 batches: **61 fern-cluster cells (D<n>-g), 0 flowers**, 2 lantern posts, 2 lamps | no decorator, park or dress code at e6a1ea2b |
| Flowers in bags | 2 (1 dandelion, 1 poppy) in 13 bags. 7 d: no bag ever held more than 2 | 24 h: most bots hold 0; at most 8 (placebo-d) |
| Flowers in town chests | **0** in 27 indexed chests (coverage full; the positive control is bone_meal 4 in the same read) | n/a |
| Bone meal | town **4** (exactly the park's reserve, NURSERY.mealKeep). 7 d: no bag held more than 4 | 24 h: mostly 0-1 a bot, one bot 65 |
| Composter | 55 runs in 7 d, **0 bone meal** (2-5 items a run: brown mushroom, glow berries). 3 composters carried, unplaced | 284 runs in 24 h; compost bone meal "popped but not confirmed" 15 times |
| Nursery (decorator-01) | 7 d: 6 visits, **8 meals, 2 flowers harvested** (1 dandelion, 1 poppy), 4 short + 4 tall grass | n/a |
| Decor demand | sink picker, 7 d, 4,535 decor states: **no_site_wait 3,870**, ok 543, no_pressure 73. The paths' sides are used up, so a new batch cannot be sited | n/a |
| Wild flowers outside the protected villages (map census, y 48-127) | within 48 of home: 4; 48-160: 3; 160-200: 16; 200-320: 124; 320-640: 416. **All poppy and dandelion.** Variety (oxeye, bluet, cornflower, lilac, rose bush, peony) only beyond 640 (plains, forest). The villages hold 37 more within 128 | n/a |
| Ferns (compost feed) | within 160: 593 fern + 614 large fern; within 640: 9,159 + 12,260 | n/a |
| Short grass | within 640: 5,657 | n/a |

The live nursery made 0.25 flowers a meal, against 2.75 in Paper (below). Three reasons, all in the code:

- **Its "enough" test counted ferns.** `borderPlantsOf` counts ferns, and the fern gather runs first, so the bag
  read as full and the nursery seldom ran. (Codex found this in its design pass.)
- **Meals were never checked.** A meal on a covered centre is refused (Paper M3), but the row was logged on the ack.
- **No bone meal.** The town held exactly the 4 the park keeps back, and the composter never filled.

## 2. Paper facts

Paper 1.21.8-60 (the showcase's build), sandbox5. The scripts are `sandbox/flowers/flower-proof.cjs` and
`flower-proof2.cjs`. The bot acts through its own `botBuildEffects`. Plants are counted by the server: a destructive
`fill ... air replace <name>` over a rebuilt arena, and bag counts with `clear <name> 0`. The rows are in
`sandbox/flowers/flower-proof.jsonl`.

- **M1, open taiga grass, 8 fresh meals:** 2.75 flowers a meal (all poppy and dandelion), 17.1 short grass, 2.5 tall
  grass. Every meal was spent. **Taiga does give flowers**, just not ferns: no meal grew a fern.
- **M2, half the grass broken up (checkerboard podzol):** 1.25 flowers and 5.75 grass a meal. The nursery's ground
  matters.
- **M3, four meals on one centre with nothing cleared:** 7 plants from the first meal. **The next three were refused
  and not spent:** the first meal covers the centre. With the spread cleared between meals: 2, 3, 4 and 2 flowers.
- **M4, other biomes:** snowy_taiga gives poppy and dandelion; plains gives dandelion and azure bluet; meadow gives
  poppy.
- **B1:** bone meal on a placed poppy does nothing, and the meal is kept. Small flowers do not multiply in Java.
- **B2:** bone meal on a lilac is spent and drops a lilac. Tall flowers can be copied, one meal each.
- **B3:** bone meal on short grass gives tall grass.
- **S1b:** shears on tall grass drop 2 short grass. Shears on short grass drop 1. Short grass broken by hand gave 0
  seeds in 6 tries, which is only a count.
- **C1b, composter:** 58 ferns made 6 full cycles, about 9.7 ferns a bone meal (the expected value is 1 + 6/0.65 =
  10.2). 61 short grass made 3 cycles, about 20 a meal. The harness picked up 7 of the 9 popped meals; the compost
  skill has its own pickup walk.
- **P1:** a picked poppy goes to the bag. It replants on grass, podzol, coarse dirt and dirt.
- **P2:** a poppy placed by clicking the soil under a fern replaces the fern. A click on the fern itself also places
  it in the fern's cell.

## 3. Supply, ranked by cost per flower in this world

1. **Flowers already held** (bag, then town). Today that is 0.
2. **The nursery, fed from the composter.** It renews itself and stays at home. One meal on cleared grass gives 2.75
   flowers plus about 20 short grass. With shears, that grass is about 0.9 of a meal back at about 20 a meal. So the
   loop nearly pays for itself, and **feed ferns** cover the gap (about 10 ferns a meal, and 1,200 stand within 160).
   The net cost is about one fern per flower plus the digging time (about 20 digs per meal for the clearing).
3. **Wild picks.** One dig per flower and no meal, but there are only 7 within 160 outside the villages. The 147
   between 160 and 320 need a trip.
4. **Tall-flower copies** (one meal per lilac, rose bush or peony). The starter plants are only beyond 640. This
   would give lawn accents, not borders.

## 4. Design (flowers-01, showcase)

- **Border upgrade.** A fern-cluster cell (`D<n>-g`) standing its fern is re-roled to `D<n>-u<k>`. The new role's
  palette is the batch's flower scheme with no fern in it. Two cells in three of each run are upgraded and one in three
  stays a fern, so there is green between the flowers. Which cell stays is set by a seeded phase per segment, and the
  position counts the run's upgraded cells too (Codex r1 blocker). A re-role happens only for as many cells as the bag
  holds flowers (at most 8 a visit). The publish reads the record again inside `publishRecord`. The same visit's build
  then places the flowers, and each one replaces its fern (P2). On the live record that is 42 candidates, with 19
  ferns kept.
- **The refusal chain.** An upgraded cell standing a fern, or bare, while the bot holds no flower is **done for the
  visit** (`upgradeWaits` in runVisit's alsoDone) and is **never damage** (the recordDamaged loop). Nothing is dug for
  a flower the bot does not hold, and no record reads damaged for want of flowers. With no supply step possible,
  `flowerWork` says `no_supply` and the decor is not due. A visit that changes nothing stamps the town's
  `decor_flowers` stall for 2 h (TOWN_NOSITE_MS), and the decorator is let go.
- **Demand without siting.** The decor upkeep is `due` when there is a border to upgrade and a supply step this bot
  can take (flowers, a meal, feed, a wild flower, or a feed fern to cut). That `due` bypasses the siting's no-site
  wait, because the paths' sides being used up does not stop an upgrade. It does not bypass its own stall stamp.
- **Supply steps in the decor visit, in order:**
  1. the wild pick (`flowerTargets`: never a reserved column, a record cell or column, inside the walls, a nursery's
     spread, or more than 128 from home);
  2. the fern gather with the feed added (`feedFernNeed`: up to 8 kept plus 24 feed while the town's meal is under 16);
  3. the nursery, asked for **flowers**. It clears its **whole spread** before a meal (`nurseryClearing`: blooms and
     grass within 7, the core first, the grass cut with shears as feed). The meal waits until the centre and 80% of
     the core are open, and **counts only if the server spent it**;
  4. the compost drive. The composter takes the bag's ferns above 8 through `setDecorFeed`, set only where the
     decorator and FLOWERS are on. Flowers stay kept;
  5. the upgrade publish.
- **Switch:** `FLOWERS=off` returns everything to the 272288e1 behaviour. Cells already upgraded keep their flower
  roles, and with no flower in the bag they read done (they wait).

**Lawn scatter is piece 2 (flowers-02).** A meal on a lawn centre whose spread holds no path, plot, farm or record cell
gives the vanilla scatter: 2.75 flowers, 17 short grass and 2.5 tall grass per 225 cells, the natural density in the
target pictures. A meal only lands on grass blocks, so it never lands on a path. Piece 2 needs piece 1's bone meal
economy first.

## 5. Codex's independent design and the reconciliation

Codex (read-only, given the measurements and the goal, not this design) ranked the sources: known wild flowers, then
distant trips (24-32 flowers per expedition), then tall-flower copies, then the nursery. It judged the nursery
"neither a proven flower source nor self-funding", citing the live 4 meals per flower. For the first piece it proposed
small-flower collection plus border upgrades with four cells a visit: `flowerDemand`, `flowerGatherTargets`,
`borderUpgradePlan`, a refusal ladder, a 30-minute suppression after two empty visits, a feed-fern bootstrap of 64,
"never apply another meal after incomplete cleanup", and a check that 65 of 81 core cells are open.

- **Agreed and built:** upgrade existing fern cells, two flowers per kept fern; an explicit re-role, because a `g`
  cell whose palette only widened would still read its fern as done; ferns never satisfy the flower demand; the
  refusal ladder (held flowers, wild, production, then keep the ferns); supply runs independently of the new-site
  wait; the whole spread cleared before a meal; feed ferns kept apart from the border's keep; protected-village
  flowers excluded.
- **Different:** the nursery comes second, not last. Paper measured 2.75 flowers a meal on cleared taiga grass, and
  the live 0.25 is explained by three code defects (section 1). Wild picks stay as the first rung, but they hold only
  7 flowers near this town. Trips to 160-320 belong to the expedition machinery (piece 3), not the decor visit's
  walk. The stall backoff is the town's existing 2-h stamp, not 30 minutes. The upgrade cap is 8 a visit, not 4,
  because the visit places them in the same build.
- **Codex review (one round, blockers only):** one blocker. Repeated upgrades shifted the kept third, so one-flower
  visits would have taken the last ferns. Fixed, with a repeated-upgrade test and its mutant.

## 6. Pieces and placement

| Piece | Lane | Tier | State |
|---|---|---|---|
| flowers-01show (this) | showcase | 2 (protected.py: not protected) | built: branch `flowers-01show` @ **e841547a** on 272288e1; ready to stage |
| flowers-02 lawn scatter (meals on lawn centres) | showcase | 2 | after flowers-01's read shows bone meal flowing |
| flowers-03 flower trips (atlas flower finds, expedition to 160-320) | showcase | 3 if it touches goto | design |
| flowers-04 tall-flower stock (lilac, rose, peony beyond 640; one meal per copy) | showcase | 2 | design |
| fleet | none | - | **does not apply**: the fleet has no decorator, park or dress at e6a1ea2b |

- **Tripwire:** DC6 `kind=wild` (a small flower within 128 of home, never guarded, park or tidy; the villages are
  G3's) is on main's `shopread.py.txt`, with selftest and 3 harness mutants (226/226 killed). **Not installed.**
  - The nursery's whole-spread clearing stays inside DC2's spread.
  - Meals are still DC1's.
  - Upgraded-cell placements are G1's, since the cells are in force.
  - `_decor op=upgrade` and `op=wild` are decision rows, not mutations.
- **Read** (+2 h and +24 h after activation):
  - `_decor op=upgrade` n;
  - border cells by role, aiming for 42 upgraded;
  - `_build op=meal` rows against meals spent;
  - flowers harvested per meal (aim ≥ 2);
  - `_compost` bone meal out;
  - town bone meal;
  - `_decor op=stall` count, and the `decor_flowers` stamp (it must lift).

**Tests and suites:**

- Targeted: flowers 21/21 (16 behaviour tests incl. two real-runVisit scenarios and 7 anchored mutants, plus 10 wiring
  assertions each with its text mutant), decorator 55/55, sinks, sinkwaive, prodserve, towndress, reroof and sinkfix4
  all pass.
- ci2 @ 07450d08: 457/461. prodserve and towndress failed on anchors, fixed in r2/r3 (the decor arm is now leave0's
  first arm). lavastep is a known flake. nothing-important-is-orphaned fails on the live base (bagdiet).
- w30 @ e841547a: 456/461. The failures are lavastep and plinth-skill (known flakes), nothing-important-is-orphaned
  (the base's bagdiet), well (a known base failure), and ziggurat-v2-build (`killed: timeout` on the loaded w30; it
  passed on ci2 r1, and that code is untouched).

## 7. Risks

- **Ferns near home get cut.** Feed ferns are cut within 48 of home (DC4's reach). About 470 ferns stand within 64.
  That is a visible change to the forest floor by the town; the grass recycling is the renewable part.
- **Clearing takes time.** About 20 digs before each meal, so there is one meal per decor visit in practice.
