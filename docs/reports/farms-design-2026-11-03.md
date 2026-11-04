# farms: crop farms, a bakery, animal pens (design, 2026-11-03)

Owner 11-03: "yes design all using both claude and codex, put them in the queue and implement and deploy where you feel is
right". The item: animal farms (fenced pens; lead or wheat-lure cows and sheep; breed; shear wool; leather) and crop farms
with a bakery (wheat, carrot and potato plots near town with water; harvest and replant; bread). The worlds are PEACEFUL, so
food is not needed to survive (owner 10-05, `bots/src/foodskip.mjs`). The value is trade goods for the villager-trading item,
wool for beds and colour builds, leather for bundles and books, and steady visible work. Ledger row `farms-1103`.

## 1. Measured (2026-11-03, `scripts/lib/telemetry.py` full walks)

`perception.entities` counts mobs within 24 blocks of the bot (`bots/src/state.mjs` perception). "Near" means the bot stood
within Chebyshev 48 of its town's home.

**Showcase** (home 0,70,0; 10 bots; 7 days; 100,300 perception rows). Near-town rows that saw a cow, sheep or pig:

| day | 10-27 | 10-28 | 10-29 | 10-30 | 10-31 | 11-01 | 11-02 | 11-03 |
|---|---|---|---|---|---|---|---|---|
| rows with cow/sheep/pig | 72 | 852 | 872 | 337 | 0 | 39 | 0 | 0 |
| near rows (denominator) | 1,462 | 10,438 | 9,911 | 10,380 | 5,210 | 9,458 | 8,948 | 8,576 |

- Positive control for the zeros: in the last 24 h the same near rows saw wandering traders (33 rows). Far rows saw chickens
  (256), villagers (226) and foxes (210).
- Animals left the town around 10-30. That is when the wall (81 x 60 blocks) and the groundskeeper's grading were built.
  This says *when*, not *why*.
- In the last 2 days, the nearest cows were seen 112-160 blocks west of home (10 rows) and sheep 112 west (3 rows). Pigs were
  16-96 blocks out and are the most common.
- Bags: all 10 bots hold an empty bucket. None holds seeds, a hoe, shears, wool, leather or a lead. The park skipped its
  crops as `no_seeds`, and no town chest holds seeds (townterrace report).

**Fleet** (80 bots, 16 towns; 24 h; 1,976,085 rows; 98k perception rows; 57,341 of them near a town):

| animal | near rows with it | share |
|---|---|---|
| cow | 4,732 | 8.3% |
| chicken | 4,177 | 7.3% |
| pig | 3,200 | 5.6% |
| sheep | 1,560 | 2.7% |

- Cows reach at least 5% of near rows in 5 of the 16 towns (board-a, board-b, hive-b, placebo-a, placebo-d).
- Sheep reach 5% in only one town (placebo-d, 1,108 of 3,337 rows).
- No near row ever held more than 3 of one animal.
- hive-c, hive-d and isolated-a see no cows near town at all.

**Composition: a farm is dead on arrival as the code stands.** wheat, beetroot, melon and pumpkin seeds are on several lists
at once:

- hygiene `NEVER_KEEP`, so a bot never walks to them;
- composter `isCompostJunk` (which keys on `NEVER_KEEP`), so the composter eats them;
- towndeposit's junk test, so they are never banked;
- `pickuplog` JUNK;
- skills `JUNKSWAP_ITEMS`, so they may be dropped at a full chest.

A farm needs seeds kept. That is two correct guards composing into a dead end, the trap named in `CLAUDE.md`.

**No bot code calls `bot.activateEntity` or `bot.attack` today.** Entity work was behaviour nobody here had seen work, so it
was proven in a Paper sandbox first (section 5).

## 2. The design (Claude)

**Pieces, in order:**

| # | piece | tier | lane | needs |
|---|---|---|---|---|
| 1 | **cropfarm-01show**: keep seeds while farming is on; a wheat farm as a showcase PROJECT, with seed gathering from grass, till, plant, harvest and replant, and wheat banked | 2 | showcase | Paper proof (done, sec. 5); tripwire rule (sec. 6) |
| 2 | **cropfarm-02**: a water channel (bucket fill from a pond and pour into a dug channel, proof needed), torches on the walkways, carrot and potato rows once a natural source is recorded (village crops, trading) | 2 | showcase | bucket fill/pour Paper proof |
| 3 | **bakery-01**: a small bakery shelter (table, chest, sign) and bread from 3 wheat; bread must be banked, so its exemption is added to the bank's food refusal | 2 | showcase | none (the bread craft is proven) |
| 4 | **pens-01**: two fenced pens (cow, sheep), 7x7 grass floor, a gate and a two-gate vestibule; built as a project, empty at first | 2 | showcase | fence + gate proof (done) |
| 5 | **herd-01**: fetch animals with a wheat lure (preferred) or a lead, from recorded sightings (the expeditions' markers); breed to a cap; shear sheep | 3 (entity behaviour, two engines) | showcase first, then a fleet canary | lure, lead, breed, shear proofs (done); escape, cramming and Paper activation range proof |
| 6 | **leather-01**: cull surplus adult cows inside the pen only, keeping 2 breeders per species | 3 | showcase, then a fleet canary | attack proof (done); breeder protection |

**Siting (pieces 1, 4).** Farms go in the land plan's `farms` zone (`landplan.mjs` zoneAt). If no site fits there, the
fallback is the town ring with the wall's inside (`town`). The footprint is checked whole:

- every column must avoid every project's record and its siting zone (`farmBlocked`, as the tree farm's);
- the park box + 2 (`parkZones`), every land corridor (`landReservation`), every sink instance, the yard's record and the
  protected zones;
- each crop cell must read tillable soil (grass, dirt or path) with air above, and the bed's ground must be within 1 of its
  median.

A cell within 4 blocks of still water at the bed's level is hydrated; the site with the most such cells wins (ties go to the
nearest to home). No site means a named `no_site` row and a 30-minute back-off, never a displaced building. The record
publishes once and is a reservation every later planner keeps off (`recordZones`), so the terraces, sinks and yard keep off
it.

**Layout.** Crops grow at half speed when the same crop is diagonal to them or on both axes (vanilla CropBlock
`getGrowthSpeed`). So the bed is ROWS: crop rows 7 long, separated by 1-wide grass walkways, which are also the stands.
- One row costs ~23 random ticks a stage dry, ~8 wet (vanilla formula; to be measured).
- A mature row takes ~3 h dry or ~1 h wet.
- v1 is 4 rows x 7 = 28 crops (9 x 7 box).

**Seeds.** While `CROPFARM` is on in a pool, wheat_seeds leave `NEVER_KEEP`. That one switch flips the walk-to, the composter
(`isCompostJunk`), the bank and junkswap together. A farm visit with fewer seeds than open crop cells digs short and tall
grass (12.5% a seed) within 24 of the farm, off every record, the park and zones. At most 24 grass a visit, logged
`op=clear kind=seedgrass`.

**The loop.** A complete farm is never "damaged". Harvest and replant are UPKEEP (`due`: after every open project, as the
tree farm's), so the farm never holds a building project back. Each visit:
1. harvests up to 12 age-7 crops (digs `op=harvest`, then walks over the drops);
2. runs `runVisit`, which tills the lost farmland and replants the empty cells from the bag;
3. banks wheat and the seeds above the farm's keep (one full planting + 8).

The visit ends itself before the watchdog. A full bag (fewer than 4 free slots) or no chest room means no harvest that visit.

**Bounds.** One farmer slot; a 2-builder cap for the build. A town keeps at most 2 stacks of wheat (128) before a harvest
waits; when that cap is reached the harvest stops and a row names it. Seeds are kept up to 64 a bot (one slot). Pens (pieces
4-6) cap at 6 animals per species, babies included; an unknown census stops breeding and culling.

## 3. Codex's independent design (codex exec, read-only, 11-03; summary)

"Build a small wheat farm and bakery first; add livestock only after crops sustain themselves."

1. **Supply policy and bootstrap (tier 2).** Town farm reservations shared by pickup, hygiene, composting, the peaceful kit,
   junkswap, crafting and chest transfers. Bread faces composting too. Test the whole chain: acquisition, pickup, deposit,
   withdraw, plant, including another bot's clean-up pass.
2. **Wheat plot and bakery (tier 2).** Follow `treefarm.mjs` (records, PROJECTS, leases, runVisit, then upkeep that falls
   due), and reuse the park's hoe `useFor`. 16 wheat cells, shallow contained irrigation, level paths, lighting, a chest and a
   small bakery shelter. Verify seeds and water before the project counts as ready.
3. **Pens (tier 2 construction; tier 3 acquisition, breeding and shearing).** Separate cow and sheep pens with two-gate
   vestibules. Admit animals only after the enclosure is inspected. A wheat lure first; leads optional.
4. **Leather (tier 3).** Cull only surplus adults inside the registered pen, keeping 2 breeders. No wild slaughter.
- **Siting** through the land record's zoneAt=farms, preferably beside a spoke. Check the whole footprint plus a buffer.
  Publish reservations before earthwork. Re-check the active terrace segments' work-time guards against the farm.
- **Acquisition:** grass breaking for seeds; scout the measured 112-160 W area for animals; one handler, one animal at a
  time, a 10-minute budget, back off after a failure.
- **Bounds:** one farmer lease; visits at most 2 min; a reserve of one planting + 8 per crop and 16 breeding wheat; 4 free
  slots; a chest-capacity check; at most a stack per commodity carried; 2 stacks of town output; at most 6 animals per
  species.
- **Proofs:** grass drops, hoe, bucket fill/pour, hydration and light, maturity, drops, planting acks, bread; lure distance,
  gate passage, entity identity across reloads, activateEntity consumption, baby recognition, breeding cooldown, shearing and
  grass regrowth, Paper activation range; lead attach/break/release; attack drops.
- **Queue:** copper hall + signs -> showcase 10 -> crop/bakery acceptance -> 15 bots -> second brain; storehub stays after 15.
  Livestock follows its proofs. Sandbox success does not downgrade tier 3.

## 4. Reconciliation

| point | Claude | Codex | decision |
|---|---|---|---|
| first piece | wheat farm + seed keep, one piece | seed policy as its own piece first | **one piece**: the keep switch is a few lines and useless without the farm; its composition test ships with it |
| water in v1 | none; prefer naturally hydrated sites | shallow contained irrigation in v1 | **v1 without placed water**: bucket fill is unproven here (bucket.mjs: "FILLING a bucket is unvalidated across mineflayer"); dry rows still grow (~3 h); water is piece 2 after a proof |
| bed size | 28 crops in 4 rows | 16 cells | **28 in rows**: rows avoid the half-speed penalty, and walkways are the stands |
| bakery | its own piece 3 | with the plot | **piece 3**: bread hits the bank's food refusal (towndeposit); its own small change |
| livestock tier | 3, showcase first, two engines | 3; sandbox success does not downgrade | **agreed** |
| lead vs lure | lure preferred | lure first, leads optional | **agreed**. Both are proven; the lure needs no item crafted (leads need slime) |
| leather | cull inside the pen, keep 2 breeders | the same | **agreed** |
| bounds | 2 stacks of wheat, seeds 64 a bot, 6 animals | the same caps plus 16 breeding wheat | **adopt Codex's 16-wheat breeding reserve** in piece 5 |
| terrace guards | the record is a reservation | re-check active terrace segments at work time | **adopt**: the terrace's work-time guard reads records through `projectHeads`, so a published farm is seen at the next segment; noted for review |

## 5. Paper proof (sandbox3, Paper 1.21.8, mineflayer 4.37.1)

The driver is `sandbox/farms/farm-proof.cjs`. RCON builds the arena and hands the kit; that is sandbox only. Each bot step
goes through the mineflayer call a skill would use, and each result is read back from the SERVER (`execute if block`,
`data get entity`). The results are in `sandbox/farms/farm-proof.jsonl`.

**Run 3: 15/15 PASS.**

| step | call | server result |
|---|---|---|
| till | `activateBlock(grass, up)` holding a wooden hoe | farmland |
| plant | `placeBlock(farmland, up)` holding wheat_seeds | wheat, 1 seed spent |
| grow | randomTickSpeed 300 | age 7 in 50-65 s |
| harvest | `bot.dig(wheat age 7)`, walk over the drops | +1 wheat, +3 seeds, farmland kept |
| replant | `placeBlock` | wheat |
| fence ring | 16 `placeBlock(grass, up)` | 16/16 fence + gate |
| gate | `activateBlock(gate)` x2 | open=true, then open=false |
| wheat lure | bot holding wheat walks 12 blocks | the cow followed (stayed 2.1-2.3 away, moved 15 blocks) |
| lead attach | `activateEntity(cow)` holding a lead | `attach_entity` cow -> bot; 1 lead used |
| lead walk | walk 10 blocks | cow within 2.6-3.5 |
| lead tie | `activateBlock(fence post)` | `attach_entity` cow -> leash_knot |
| breed | `activateEntity` x2 holding wheat | 2 wheat used; a calf in 3.0 s |
| shear | `activateEntity(sheep)` holding shears, 3 sheep | Sheared=1b on all 3; 5 wool picked up |
| attack | `bot.attack(cow)` with the hand, ~700 ms apart | dead in 11 hits; leather 2 + beef 1 (run 2: leather 0, beef 2) |
| bread | `bot.craft(bread)` at a table | +1 bread |

- **Runs 1-2 failed, and the causes were the driver's, not the server's.** Run 1's till ran before the chunk loaded
  (`blockAt` null; fixed with `waitForChunksToLoad`). Its attack swung from out of reach (fixed by approaching to 2.8).
  Run 2's shear targeted the wrong sheep (fixed with tagged sheep and an approach).
- **Still to prove** (pieces 2 and 5):
  - bucket fill from a still pond and a pour into a 1-cell channel (does the source stay?);
  - hydration and light at real speed;
  - animal escape over a pen corner and through an open gate;
  - entity cramming at 6;
  - Paper's entity activation range (do animals 20-40 blocks from the nearest bot still breed and grow?);
  - grass regrowth (sheep eating grass);
  - entity identity across a bot reconnect.

## 6. The showcase tripwire (`docs/reports/shop-01-2026-10-25/shopread.py.txt`)

Piece 1 writes `_build` rows with `project=cropfarm`:
- `op=place` on its record cells: the hoe's farmland and the seeds;
- `op=harvest` (a crop dug on a record crop cell);
- `op=clear kind=seedgrass` (a grass plant dug for seeds).

New rule **G9 farm_dig**:
- a harvest must be a record crop cell, and its block one of wheat, carrots, potatoes or beetroots;
- a seedgrass clear must be a grass plant (short_grass, tall_grass, fern, large_fern) that is off every project's record
  cells, outside the park box + 1, and within 24 (Chebyshev) of the farm's box.

G1 (place on the record) and G3 (zones, now also judging `op=harvest`) already cover the rest.

## 7. Queue placement

- **Showcase lane** (Claude and Codex agree): copper hall finish + signs -> showcase 10 -> **cropfarm-01show** (released with
  its tripwire rule) -> 15 bots -> second brain -> storehub.
  - Farm work is steady work for the 5 new bots, so it is worth having before the 15-bot step.
  - Codex put crop acceptance before the 15-bot step too.
  - pens-01 and bakery-01 follow on the showcase after the farm's first harvest cycle; herd-01 after its remaining proofs.
- **Fleet lane:** none yet. Cows reach 5% of near rows in 5 of 16 towns and sheep in 1, and the fleet has no land plan in
  most towns, so a fleet farm is cropfarm-only, as a **P** entry after the showcase shows a full harvest cycle (tier 2,
  owner-direct with a 60-min tripwire). Livestock goes to the fleet only as a tier-3 canary, after the showcase herd has run
  a week.

## 8. Risks and rollback

- **Trampling:** farmland turns to dirt when an entity falls more than 0.5 onto it. Walking does not trample, and the
  walkways are level grass. The visit re-tills lost farmland (a `till` cell is open again).
- **World damage:** the farm digs only grass plants and its own crops. It places farmland (by the hoe) and seeds on its own
  cells.
- **Bags:** seeds are kept to one slot, and wheat is banked each visit.
- **Rollback:** `CROPFARM=off`. The project is never picked, seeds are junk again, and the record stays as a reservation. A
  code rollback is clean. The farm's blocks stay in the world, which is harmless.

## 9. Built: piece 1 cropfarm-01show (11-03)

**Branch and base:**
- branch `farms-01show` @ `298ed65d` (r3: the crop farm listed only where the tree farm is on; order tests updated), on the live showcase release branch `origin/showcase-gkpick-on-adbf9e41` (cbd2f51b);
- tier 2 (`protected.py`: not protected);
- rollback: `CROPFARM=off`, or the base sha.

**Files:**
- `bots/src/cropkeep.mjs` (leaf): the switch, plus `neverKeepFor`. hygiene's `NEVER_KEEP` and skills' `JUNKSWAP_ITEMS` are
  built through it.
- `bots/src/cropfarm.mjs` (pure): the layout, siting, record, crop states, harvest, due test and seed-gather targets.
- `bots/src/shop.mjs`: the PROJECTS entry after the tree farm, `projectsOn` gating, and the record always guarded.
- `bots/src/skills.mjs`:
  - `buildCropFarm`, with `cropHarvest`, `cropSeedGather`, `cropHoe` and `cropInputs`;
  - the dispatch;
  - `recordDamaged` treats the farm as due, never damaged;
  - `blueprintOf` uses `CROP_PALETTE`.

**The visit, in order:**
1. Harvest (bounded by the town's wheat cap and free bag slots).
2. Draw seeds from town.
3. Gather seeds from grass round the farm.
4. Craft a hoe if needed.
5. Run `runVisit` (till, then plant; a cell with no seed is passed).
6. Bank the wheat and the seeds above one planting + 8.

An empty farm with no seed is due again once its 30-min gather back-off ends.

**Tests:** `bots/test/cropfarm.test.mjs`, 21/21.
- Layout, siting (reservation, level, water, plants, zones, hydration).
- Crop states, the due test, alsoDone, stands, seed targets.
- The seed keep composed through hygiene, the composter and `notForChest` in child processes per pool.
- A runVisit end to end on buildfake.
- Wiring.
- 5 mutants, each anchor asserted unique.

**Reviews:**
- Codex r1 found 2 blockers: banked seeds were never drawn, and the seed search ran round the bot, so an empty farm was never
  due again.
- r2: one fix incomplete (`takeAllowed` -> `shopAllow`).
- r3: APPROVE.
- Suite on .30 (8b5ed792): 386/400. The 6 known base failures plus flakes lavastep and plinth-skill, and 6 new ones, all from the
  project list: house, paths-wiring, shop, showcase-on-fleet, wall-wiring, ziggurat-project. All six fixed in 298ed65d and
  re-run green alone. Full suite on ci2 (298ed65d): 396/400. Every failure is a known base failure or flake: ceilescape,
  nothing-important-is-orphaned, protected-paths, craftsync.

**Tripwire:** G9 farm_dig in `docs/reports/shop-01-2026-10-25/shopread.py.txt` (main, NOT installed). Selftest passes.
- Claude (independent subagent): APPROVE.
- Codex r1 found 1 blocker: a seed-grass dig on a tidy cell went uncaught. The fix judges against the tidy generations that
  could have been the head when the grass was dug (`tidy_heads_at`, across the 60-s skew); the head is what the bot's own
  guard reads.
- Codex r2 and r3 each refined the skew handling: no future head on its own, and all heads when none was sited before the
  dig.
- Codex r4: APPROVE. 92/92 mutants killed.

**What the release needs:**
- Install the G9 shopread on the showcase VM with the release.
- Fold `farms-01show` onto the next showcase restack.
- After activation, look for these rows:
  - `_build project=cropfarm op=sited` (the site, `crops28/wet<n>/<orient>/<zone>`);
  - `_build_visit project=cropfarm` (`harvested`, `seeds +n`);
  - `_build ... kind=seedgrass`;
  - `_structure_complete project=cropfarm`.
- G9 and G1-G3 should read 0.
- The goal is visible when wheat rows stand south of the town (the land plan's `farms` zone, S on the showcase) and a full
  harvest cycle has run.
