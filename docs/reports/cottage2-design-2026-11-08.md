# cottage2-01: charming, varied, furnished cottages (design, 2026-11-08)

**Owner, 2026-11-08 ~20:00Z:** "yes, use AI claude/codex to add some charm and uniqueness to the cottages, you can put chests and
beds in cottages".

**What is done.** A generated family of 24 cottage looks, each with 2 or 3 beds and 1 or 2 chests, lanterns, window boxes and
(on some) a chimney. Two more cottages are offered on the wall extension's free house plots (X4, X5); each takes its own look and
wood, and never looks like a neighbour. A wool source (shearing a sheep in sight) feeds the beds. Every new block kind was placed by
a bot's own click on Paper and read back by the server.

**Code:** branch `cottage2-01show` on `buildsite-01show` ec3774e8 (showcase only, tier 2: `protected.py` says not protected).
**Tripwire:** CT1 + RO1 for beds and chests, in `docs/reports/shop-01-2026-10-25/shopread.py.txt` on main. Not installed.
**Pictures:** [`cottage2-2026-11-08/cottage2-sheet.png`](cottage2-2026-11-08/cottage2-sheet.png) — before (flat house@1, cottage1)
and after (the two cottages a replay sited on the showcase, with cutaways of their rooms), then four more looks.

## 1. Measured (showcase, 11-08 ~20:13Z, read-only copies of the live world and the town index)

| What | Number | Denominator / control |
|---|---|---|
| Villagers in the world | 63 | 1,586 entity chunks; 25 entity kinds counted (positive control: 1,409 falling blocks, 520 rabbits, 213 sheep) |
| Villagers employed | **0** | of 63 (all `none` or nitwit) |
| Beds (POI `home`) | 129, **104 free** | world-wide |
| Village 6_1 (nearest, x 49-157) | 7 villagers, 5 beds, **3 free** | births in 2 days of mobGriefing: 0 (mobgrief-1106) |
| Cottage plot X3 to the nearest 6_1 villager | ~90 b | vanilla breeding looks for a free bed within 48 b of the parent that it can path to |
| Sheep within 100 / 100-200 / 200-400 b of home | 1 / 2 / 50 | 213 sheep saved in the world |
| Showcase rows seeing a sheep (perception, 40 b) | 354 rows, **242 bot x 5-min windows**, all 14 bots | of 221,775 rows today (00:08-20:24Z) |
| Wool / beds / string in 27 town containers | 0 / 0 / 0 | positive control: cobbled_deepslate 1,010, spruce_log 505, stone_bricks 358 |
| In the 14 bots' bags | 195 chests, 13 shears, 0 beds, 0 wool | 14 of 14 bots' latest rows read |
| Town logs | spruce 505, oak 76 | iron 122, wheat 141, moss 165, torch 80 |
| Container fullness | 281 of 729 slots (38.5%); 4 of 27 chests full | full ones: logs (2), stone, deepslate. The ~88% figure is the fleet's |

**The honest reading on breeding.** On this world beds are not what stops villagers breeding. Village 6_1 already has 3 free
beds and has had none of the 2 days it needed. Breeding needs **food** (each adult 12 points: 3 bread, or farmers sharing crops) and
a free bed within 48 b that the parent can walk to. 6_1's seven are penned, jobless (no farmer) and unfed. The cottages are ~90 b
from them, so cottage beds will **not** raise births there. What would: the market composter (a farmer) beside the village, bread
the bots can make (141 wheat = 47 bread) handed over, and villageunlock-01 (queued, protected). Beds help only once villagers live
near the town. Both independent designs reached the same conclusion.

## 2. The design (Claude + Codex + an independent Claude design, reconciled)

| Point | Claude | Codex | Independent Claude | Taken |
|---|---|---|---|---|
| Sizes | 5x5 / 5x7 room | 5x5 / 6x6 / 7x7 | 5x5 / 5x7, span always 5 | **5x5 and 5x7 along the ridge.** A 6- or 7-wide span puts the ridge out of the floor's reach (y 7+). |
| Roofs | gable / low slab | gable / 1:2 slab | gable / slabRoof | Both, the halls' proven 1:2 form for the low roof. |
| Uniqueness | seed + neighbour check | reject a neighbour's signature, persist | differ in >= 2 axes | **>= 2 of body / front / roof / chimney / wood, most different first**, stored in the record. |
| Porch | awning on posts | slab awning | slab awning on fence posts | Gable fronts: awning + lanterns hung under it. Eave fronts: lanterns hung under the eave. |
| Chimney | campfire smoke | unlit stone | hay bale + campfire | **Unlit stone** for now (no fire, no new block). Smoke is a later, separately proved piece. |
| Shutters | open trapdoors | place + toggle, later | place + toggle | **Not built**: a new place-then-toggle mechanic. |
| Window boxes | moss + flower | moss + flower | moss + flower (decorator's) | Moss planter + any small flower or fern; the flower waits for supply. |
| Beds / chests | 2-3 / 1-2 | 2-3 / 1-2 | 2-3 / 1-2, double chest | C: 2 beds, 1 chest. L: 3 beds, a double chest. |
| Wool | opportunistic shear | a shearing trip 200-400 b out | a shear trip, later a pen | **Shear a sheep in sight** (<= 48 b of the bot, <= 128 b of home): measured 242 sighting windows a day, no long trip. |
| Furnishing without supply | wait | furniture last | a separate segment that never blocks | **It waits**: the cottage completes without it; the first bot that can supply it places it. |
| Chests' use | overflow | repair chest, restock job | repair chest | **Town containers** (registered like the hall's): the stock view and the withdraw / kit searches use them. No deposit route yet (capacity is not short on the showcase). |
| Respawn at a bed | measure first | tier 3, not now | no | **Not built.** Death and respawn handling is protected (tier 3, fleet canary). |

### The family (`bots/src/cottage2.mjs`)

| Axis | Options | Notes |
|---|---|---|
| body | C 5x5 room (pad 7x7) / L 5x7 (pad 7x9 or 9x7) | the long side runs along the ridge |
| front | s eaves / f gable | f gets the awning (2 fence posts, 5 bottom slabs, 2 hanging lanterns) |
| roof | g 45-degree stairs (ridge y 6) / l 1:2 slabs (ridge y 5) | a hanging lantern never hangs under the low roof's top-slab eave (Paper: refused) |
| mirror | 0 / 1 | the chimney's corner and the beds' side |
| chimney | c / - (eave fronts only) | stone, up the back corner, 2 above the eave |
| wood | any species with >= 40 logs (spruce, oak here) | the roof a darker species with >= 40 logs, else the walls' |

Bill per cottage (approx., cells by role): C ~165-175 cells, L ~210-215: stone ~70-90, logs ~25-45 (walls, posts, roof stairs or
slabs, fences), 4-6 glass panes, 2 lanterns (1 iron ingot), 1-2 chests (bags), 2-3 beds (6-9 wool + planks), 2-4 moss, 2-4 flowers.

## 3. How it works

- **Beds** are one click on the foot cell; the server places the head. The head is a record cell (`byFoot`): never clicked, never a
  stand, checked clear and free of bodies before the foot's click.
- **Chests** are clicked with the yaw opposite their facing, so they face the aisle; the L body's two join into a double chest.
- **Waiting furnishing** (`furnishWaits`): a bed with no bed and no 3 wool of one colour in bag + town, a flower with none, a lantern
  with no lantern and no iron. It is done for the visit's completion, never damage and never billed.
- **Crafting** in the visit: beds from wool + planks (the record's wood), lanterns from an ingot, fences as wood parts.
- **Wool**: a complete cottage owing a waiting bed is `due` for a bot with shears that sees a woolly adult sheep. The errand walks
  beside up to 3 sheep, shears each and picks up its wool (`_cottage op=shear sheep= sheared= wool= why=`). Wool is no longer
  well junk.
- **Siting**: cottage2 after cottage1 stands, cottage3 after cottage2, each on the next free house plot, each trying its 3 best
  looks in turn. `COTTAGE2=off` rolls it back.

## 4. Proof

**Paper (sandbox6/7, Paper 1.21.8, the bots' own code).**

| Run | Result |
|---|---|
| `sandbox/cottage2/furnish-proof.mjs` x2 | **56/56**: beds in 4 facings (floor and side clicks) with their heads; a bed with its head blocked refused; chests in 4 facings, 2 pairs joined double; a lantern on a fence, hung under a bottom stair and a bottom slab; a torch on a fence; a slab on a fence; moss + poppy, dandelion, fern, cornflower. **Negative:** a lantern under a top slab is refused, and with a floor below it lands standing (the state check digs it). |
| `sandbox/townstyle/cottage-e2e.mjs`, 12 looks | First run 3 of 6: **two defects found and fixed** — a bed clicked on the neighbouring placed bed is a sleep, not a placement (beds are never supports now), and a gable front's inside torch was clicked on the back window's pane (moved beside it). After the fixes **12 of 12 complete**, every record cell's block and state read by the server (162-215 cells each, 0 reorient digs). |
| `sandbox/cottage2/shear-e2e.mjs` x4 | **20/20** after two fixes (a white sheep sends no wool byte; each sheep's pickup waits for its own wool): 3 sheep sheared and confirmed by the server, a sheep 70 b away never approached, 6 wool -> 2 beds, 1 ingot + torch -> a lantern. |

**Offline replay on the showcase (dump 11-08 08:47Z, the live siting hooks).** cottage2 sites on **X4** as `Lsl1c` (oak walls,
spruce low roof, chimney; 3 beds, a double chest; fill 54, cut 15). cottage3 on **X5**: both long looks found no proven site on its
ground, the third (`Csl0-`, oak) sited (fill 5, cut 6). cottage1 (`cottage@1f`, spruce) keeps its record.

**Tests.** `bots/test/cottage2.test.mjs` (23, with anchored mutants), and house / claim / showcase-on-fleet updated for the new
plots; full suite on ci2 (see the commit). shopread selftest ok, **240/240 mutants killed** (CT1, RO1 for beds and chests).

## 5. Rollout, read and rollback

- **Stage** `cottage2-01show` with main's shopread (CT1, RO1 beds/chests) installed. It needs `buildsite-01show` staged first: the
  branch is built on it.
- **Watch (2 h):** `_build project=cottage2 op=sited` (look, wood), `op=place` rows on `furnish` (beds, chests, lanterns),
  `_cottage op=shear` (sheep, wool), `structure_complete` for cottage2, the tripwire's H1/H6 (CT1, bag balance) = 0.
- **Effect:** beds in town 0 -> 2-3 per furnished cottage; wool banked > 0.
- **Rollback:** `COTTAGE2=off` (no new later cottage is offered; a sited one stays guarded).

## 6. Not done, and why

- **Breeding near 6_1** is food-limited, not bed-limited: needs the market's composter farmer and handing bread over (unproven: tossed
  bread was not picked up in the market proof). A separate piece.
- **Respawn at a cottage bed**: tier 3 (death/respawn handling); worth it only once bots die far from home often. Not built.
- **Shutters, smoke, fenced gardens**: each a new mechanic (toggle, fire, gates). Later pieces.
- **Overflow deposits into cottage chests**: no deposit route reaches them (the town deposit banks within 16 b of home). The
  showcase's chests are 38.5% used. On the fleet (~88% full, mostly logs), logcap-02 cuts the inflow first.

## 7. Fleet port

Fleet towns have the wall but **not the wall extension** (`WALLEXT_POOLS` defaults to the showcase), so the cottages have no plot
there. A port needs: a house-plot source on the fleet (the extension, or the town plan's own house plots), `COTTAGE` and
`COTTAGE2` on for the pools, the shopread rule installed, and the same Paper e2e on a fleet-like plot. The wool errand and the
furnishing wait carry over unchanged. Do it after pathsfix-01 and forest-01, with the timber-houses item of owner-logs-1108.
