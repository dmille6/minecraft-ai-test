# Designed bridges: stone arch, covered timber, trestle, footbridge (2026-11-08)

Owner, 11-08: "we can add or allow building bridges to our list, but if a bridge is built i want it to be something really nice
looking, professional and creative. something showcase worthy".

Still in force: the pathfinder never bridges water on the fly (owner 10-27). A bridge is a sited, designed build that the bots make
with their own clicks. No admin edits.

Code: branch `bridges-01show` on the showcase tip `showcase-wood-on-buildsite` (f11e6f0e). It is tier 2 (`protected.py`: not
protected). Switches: `BRIDGE_DESIGN=off` turns off the designs, and `BRIDGE_TRAFFIC=off` turns off the traffic sites. Pictures are
in [`bridges-design-2026-11-08/`](bridges-design-2026-11-08/).

## 1. Where bridges are worth building (measured, read-only, 11-08)

**Method.**

- **Survey** (`bsurvey.py`, scratch): the surface of every column was read from region-file copies:
  - showcase: the timelapse mirror, ±300 around home;
  - fleet: each town's region files, ±128.
- **Positions**: every log row's `bot.pos`, taken from:
  - showcase: 13 days of logs, 10-25 to 11-08 (2.62 M rows, 1.99 M with a position);
  - fleet: 11-08 only, 20.5 h (70 k to 114 k positions per town).
- **Real crossing**: one bot's samples go land → water (at least 2 water columns on the straight line) → land, within 120 s. The
  dry walk between the two ends must be more than 2× the straight line + 8; otherwise it is a shore wade, not a crossing.
- **Expedition rows**: `op=cross`, `op=turn reason=water`, and the bridge sites.
- **Positive controls**:
  - The same walk found 36,190 water columns and 19,055 swim samples on the showcase.
  - 4,708 land → water → land transits were found before the real-crossing filter kept 1,779.

**Showcase** (home 0,70,0; 15 bots; water surface y 62 everywhere). Map:
[`showcase-crossings-map.png`](bridges-design-2026-11-08/showcase-crossings-map.png). In it, red marks swims, yellow dots are
crossing clusters, and magenta lines are expedition sites.

| Site | From home | Real crossings (bots, days) | Line, depth, banks | Fit / style |
|---|---|---|---|---|
| SW shore strip below the wall (-29..-24, 58..92) | 68-90 | **780** (all 15 bots, 14-15 days) | 1-4 wide strip of open water between the bank and the lake ice, 1-2 deep | **No bridge fits.** The bots wade *along* the bank. No line crosses from shore to shore: 34 `far_bank`, 14 `far_narrow`, ice. Needs a shore boardwalk (boardwalk-02), not a bridge. [`showcase-sw-marsh.png`](bridges-design-2026-11-08/showcase-sw-marsh.png) |
| N shore x 2..9, z -87 | 87 | 26 + 63 at x 7 | w 6, depth 5, banks 0/0 | **footbridge** (47 blocks, 53 deepslate bricks) |
| W shore z 51..53, x -122..-97 | 121 | 8 | w 24, depth 2 | **trestle** (stone, 204 blocks) or **arch** at x -119 (w 18; 263 bricks: more than the stock above the keep) |
| W shore x -86..-73, z 51 | 94 | 31 | w 12, depth 2, ice 4 off | arch-sized. The lake ice is beside the line, so no lanterns there. |
| expedition sites (refused crossings) | 130-260 | sighted 1-2 trips | -115,-144 w 28 (ice on the line now); -195,172 w 7; 82,-102 w 2 (3 failed `unreached:water`) | trestle / foot / foot |
| the 2 built cobble expedition bridges (68,-76 w 10; -200,170 w 13) | — | 21 crossings by 10 bots at 63,-78 | — | never touched |

**Fleet** (16 towns, R 128, 20.5 h):

| Town | Water columns | Swim samples / positions | Real crossings (of land→water→land) | Busiest site: crossings × bots @ (x,z) dist: line L (wet), depth, banks | 2nd | Bot fill blocks in water |
|---|---|---|---|---|---|---|
| hive-d | 7,226 | 4,793 / 70,220 | **722** of 1,384 | 44 ×5 @(24,133) d78: L15 (12), dp3, 0/0 | 41 ×5 @(39,137) d75 | 773 |
| placebo-b | 6,990 | 8,576 / 95,762 | **429** of 1,790 | 37 ×5 @(358,-398) d77: L7, dp3, 4/0 | 27 ×5 @(366,-366) L6 | 849 |
| hive-c | 9,818 | 3,606 / 84,686 | **244** of 720 | 23 ×5 @(-129,-101) d70: L5, dp5 | 19 ×4 @(-115,-114) L5 | 779 |
| placebo-a | 16,073 | 5,097 / 96,575 | **224** of 816 | 14 ×5 @(311,-90) d83: L3, dp16, 6/0 | 9 ×1 L10 | 735 |
| placebo-d | 15,150 | 1,964 / 85,374 | **189** of 680 | 14 ×4 @(101,-1) d106: L4, dp14, 9/9 (a gorge) | 13 ×3 L7 | 434 |
| hive-b | 1,370 | 936 / 92,956 | 75 of 284 | 28 ×5 @(276,137) d80: L5, dp4 | 20 ×5 L2 | 79 |
| board-a | 1,403 | 381 / 92,666 | 34 of 134 | 13 ×4 @(277,169): L3 | 10 ×4 L3 | 109 |
| isolated-a, -c, -d, placebo-c, board-d, isolated-b, hive-a, board-c | 1,193-1,322 | 204-775 | 5-29 each | the shared seed's small river at x ~276: L 2-5 | | 64-100 |
| board-b | 1,502 | 9 / 88,084 | 0 of 3 | — | | 75 |

**Findings.**

- The fleet crosses water far more than the showcase does, per day. hive-d, placebo-b, hive-c, placebo-a and placebo-d are the
  water towns: 189-722 crossings a day.
- Run over the fleet maps, the bots' own traffic siting (below) finds fitting designs at most hot spots:

  | Town | Site | Style |
  |---|---|---|
  | hive-d | (5,134) | w 21 **arch** |
  | hive-d | (13,126) | w 29 **trestle** with 2 islets |
  | hive-d | (24,133) | w 9 arch |
  | hive-c | (-142,-122) | w 12 **arch** ([`fleet-arch2-sheet.png`](bridges-design-2026-11-08/fleet-arch2-sheet.png); banks 1/0 rule out the covered bridge) |
  | placebo-b | several | footbridges |

- The 9 towns on the shared seed need only footbridges.
- On the showcase, the busiest water (the SW strip) is not a crossing. The bridges that fit there are smaller: a footbridge on
  the north shore, and a trestle or arch on the west shore.
- **Materials.**
  - **Showcase:** 27 containers. It has **no surplus logs**: 307 against the owner's 512 reserve. Stone stock: stone bricks 278,
    deepslate bricks 272, cobbled deepslate 963, iron 206, lanterns 12.
  - **Fleet:** ~60,000 logs.
  - So every showcase bridge is stone today. Timber styles are for the fleet, or for the showcase once its logs pass the reserve.

## 2. The catalogue

Every picture shows the same site four ways: top view before and after, side view before and after, and an end view (looking along
the crossing). Each was drawn by `bots/scripts/bridges-render.mjs` from the bots' own design code over the surveyed ground, so it
shows exactly the cells a bot would place.

**ARCH: a stone-brick arcade** (spans 9-21, no islets, banks ≤ 2). Pictures:
[`show-arch-sheet.png`](bridges-design-2026-11-08/show-arch-sheet.png) (showcase W shore, w 18) and
[`fleet-arch-sheet.png`](bridges-design-2026-11-08/fleet-arch-sheet.png) (hive-d, w 21).

- The deck is 5 wide at the water surface + 3: a slab walkway between full edge blocks, with wall parapets.
- Stair ramps climb from each shore over the first and last rows. They stand on solid abutments down to the water.
- Under the deck are bays of 3 or 5 openings:
  - upside-down stair haunches toward the piers;
  - a contrasting keystone in the deck face at every crown;
  - piers between the bays.
- The lamps are lanterns on wall posts at the abutments and piers, with lanterns hung under the keystones.
- Seeded choices: palette (stone or deepslate bricks, keystones in the other), bays (wide or many), posts (every pier or
  alternate), crown lamps (centre, every bay or none).
- Bill: w 13 ≈ 180 bricks + 6 lanterns. w 18 ≈ 265 bricks.

**COVERED: a timber covered bridge** (spans 9-16, both banks equal at 0 or 1 so the floor is flush with both, logs above the reserve). Picture:
[`fleet-covered-sheet.png`](bridges-design-2026-11-08/fleet-covered-sheet.png) (hive-d (24,133), w 9). This is a style picture: the bot would not build it there
yet, because one of the bots' own cobblestone blocks stands in a floor cell. Bot fill in water is not natural ground, so the build never
digs it (it could be another structure's).

- The floor is 5 wide at the water: log sills along the bridge, cross beams at the bents, and a plank floor.
- The frame:
  - log posts at every bent and at both portals;
  - fence rails, with glass windows if seeded;
  - log plates along the top and tie beams across each bent.
- The roof is a 45° stair roof with an eave course, plank gables at both portals, and a ridge plank capped with a slab.
- Lanterns hang under the ridge.
- Seeded choices: bent spacing (3 or 4), sides (open or windows), lamps (every or alternate bent), and the wood species of the
  town stock.
- Bill: w 12 ≈ 142 logs.

**TRESTLE: stone and timber, for long spans and marsh** (spans 4-40, islets allowed). Pictures:
[`show-trestle-sheet.png`](bridges-design-2026-11-08/show-trestle-sheet.png) (showcase W shore, w 24, all stone) and
[`fleet-trestle-sheet.png`](bridges-design-2026-11-08/fleet-trestle-sheet.png) (hive-d, w 29, timber over 2 islets).

- The deck is 3 wide at the water surface + 2: stringers (logs or bricks), a plank or top-slab walkway, and fence or wall rails.
- The ends are stone abutments with a stair step.
- Bents come every 3-4 rows. Each has a cross beam, two legs and a cap, plus knee braces if seeded.
- Stone piers stand on the islets.
- The lamp posts alternate sides, or stand on both sides if seeded.
- The all-stone variant (showcase) uses brick stringers, a slab walk, cobbled-deepslate wall rails and polished-deepslate legs.
- Bill: w 24 stone ≈ 132 bricks + 72 cobbled deepslate. w 29 timber ≈ 124 logs + 23 cobbled deepslate.

**FOOTBRIDGE: for streams** (spans 1-8). Picture:
[`show-foot-sheet.png`](bridges-design-2026-11-08/show-foot-sheet.png) (showcase N shore, w 6).

- The deck is 3 wide at the water surface + 1, with a stair step at each end.
- It stands on piles: every row, or alternate rows if seeded.
- Rails are walls (stone) or fences (wood). Lamp posts stand at one end or both.
- Bill: w 6 ≈ 50 bricks.

**The choice** (`chooseDesign`):

1. The **shape** decides which styles are allowed (`stylesFor`):
   - footbridge up to 8 wide;
   - arch 9-21;
   - covered 9-16, on two equal banks of 0 or 1 (Paper r3: a bank one up at a portal is a jump under the tie beam, so the pathfinder finds no path out);
   - trestle beyond 21, or wherever there are islets.
2. Where arch and covered both fit, a seeded coin picks which is tried first.
3. **What the town can pay** decides the material:
   - stone above `DESIGN_KEEP` (64 of each brick, 128 cobbled deepslate, 32 iron, 32 torches);
   - logs above the owner's reserve.
4. The first style that solves and is paid for wins.
5. **The fit** is read at the site, before the first block (`designFits`):
   - every cell must be water, air or a soft plant;
   - or the support's own ground;
   - or natural ground that the build digs out first, at most 24 cells, never a placed block.

   A site whose design does not fit is marked `nodesign`. While designs are on, a new site with no fitting or affordable design
   **waits**, and its turn passes to the next due site. It never gets the plain plank or cobble bridge (Codex r1). Legacy sites
   already started are finished as they were.

Seeds come from the site id, so the same site always gets the same design. In tests, 24 sites gave 8 or more distinct designs.

## 3. Codex and Claude, reconciled

Two catalogues were written independently from the same brief: Codex, and a separate Claude agent. Neither saw the other.

| Point | Codex | Claude agent | Built |
|---|---|---|---|
| Deck width | 3 (1 walkway between edge beams), all styles | 5 for arch and covered (3-wide walkway), 3 for trestle and foot | **Claude**. The arch and the covered bridge read as civic structures only at 5. The trestle and the footbridge stay 3. |
| Arch height | segmental: deck at bank level, 2 courses under it | deck at wy+3 with stair ramps, bays under it | **Claude**. It is the only way to get real openings over the water. The ramps climb over the end rows (no land works). |
| How deep a bot can build down | 2 courses under the deck (D-3 is 4.62 > 4.5) | the same, plus a "slot step-down" for a 3rd | **Both agreed on 2.** The slot was not built: piers meet the water surface. |
| Stair facing away from the clicked face | allowed (yaw sent) | proposed a two-pass OUT/BACK order to avoid it | **One pass.** The yaw packet sets facing whatever face is clicked; Paper proved all four facings (590 oriented cells, below). |
| Covered roof | continuous plank gallery, 45° | 45° stairs, eaves, gables, ridge slab, ties at bents | **Claude's** shape, with **Codex's** headroom rule: ties at D+3 leave 2 clear cells over the walkway. |
| Lanterns | standing on full posts only; never a central hanging lamp | on wall/fence posts; hung under full blocks | **Both.** Standing on wall and fence posts was proven on Paper (a lantern on a fence or wall is valid). Hanging only under full blocks. None in the headroom. |
| Showcase timber | unavailable (307 < 512) | the same; a stone trestle variant | **Stone** on the showcase until its logs pass the reserve. |
| Build order | written per style | written per style | **Solved, not written.** One solver (`solveDesign`) places any cell from any stand by the click rules, so a style is only its cells. |
| Lights near ice | none within 3 | the same | `lightOk`: taxicab 3, unloaded cells count as not lit. |
| Expedition (far) sites | survey first | clapper footbridge | **Shape decides.** The fit is read at the site; `nodesign` leaves the site waiting (no plain fallback while designs are on). |

## 4. How a bot builds one

- **Siting.** A site comes from one of two places:
  - An **expedition's refused crossing**, as in bridgepost-01, seen by 2 trips.
  - A **traffic site** (new). Each bot runs a crossing watch every 2 s (`crossStep`), and a swim from shore to shore near town
    is a `cross` line in `expedition-<home>.crossings.jsonl`.
    - At each expedition visit, the busiest cluster with no site yet, 8+ crossings by 3+ bot-days in 14 days
      (`trafficDue`), is read in town where its chunks are loaded (`trafficSpan`).
    - It becomes a site if a design fits and is paid for. A cluster with no fitting line is not tried again for 24 h.
- **Pick.** At the next bridge trip, the design comes first, before boardwalk-01's planks and the cobble bridge.
  1. The **kit** draws the base materials from town and crafts the parts at a table: stairs, slabs, walls, fences, planks,
     polished deepslate, nuggets and lanterns.
  2. The bot takes the one-builder lease.
  3. A trip carries what it can, and the next brings the rest.
- **At the site.** The design is **named before the first block**, in a `state` line with every cell it will place. The tidy's dig
  guard, the land plan and the tripwire read those cells. A legacy site, or one whose deck is already started, is never turned into
  a design.
- **The build.** `bridge.mjs buildBridge` follows the solved plan from the walkway it has built:
  - each click is aimed: the look packet carries the state's yaw, and `block_place` carries the cursor;
  - each block and its state are read back;
  - a misoriented block of its own, or natural ground in its own cell, is dug and placed again (twice at most);
  - a foreign block blocks the build;
  - progress is read from the world, so a later trip resumes.

## 5. Paper proofs (sandbox7, Paper 1.21.8, bare mineflayer + the shipped bridgedesign / bridge / bridgeio code)

Driver: `sandbox/bridges/design-proof.cjs`. Results: `sandbox/bridges/design-proof.jsonl`.

- The arena is a sealed stone shell: the lake is 4 deep, and the banks are set per case.
- The bot builds by its own clicks. The sandbox gives it the bill of parts; K1 proves the crafting separately.
- Every cell is checked on the server with `execute if block <cell> <block>[state]`.
- The crossing is walked 8 times with the bots' walk profile (no dig, no tower, no scaffold, the shore egress).
- The bridge must survive 20 s of random ticks at 300.

| Case | Placed by the bot (build time) | Cells in their state on the server | Oriented cells | Crossings dry | Lanterns | After ticks |
|---|---|---|---|---|---|---|
| arch w13, banks 0/1 | 186 (34 s) | 110/110 + 71 supports | 59 | 8/8 | 5/5 | 110/110 |
| arch w11, banks 1/0 | 170 (31 s) | 95/95 + 71 | 53 | 8/8 | 4/4 | 95/95 |
| covered w9 spruce, banks 1/1 | 187 (33 s) | 186/186 | 132 | 8/8 | 1/1 | 186/186 |
| covered w13 spruce windows | 291 (51 s) | 288/288 | 198 | 8/8 | 3/3 | 288/288 |
| trestle w20 timber, 2 islets | 165 (32 s) | 131/131 + 28 | 67 | 8/8 | 6/6 | 131/131 |
| trestle w16 stone, banks 1/0 | 130 (25 s) | 107/107 + 17 | 30 | 8/8 | 6/6 | 107/107 |
| trestle w33 stone, 3 islets | 235 (47 s) | 196/196 + 31 | 33 | 8/8 | 8/8 | 196/196 |
| foot w5 stone | 36 (7 s) | 31/31 + 3 | 2 | 8/8 | 2/2 | 31/31 |
| foot w4 wood, banks 1/2 | 31 (6 s) | 26/26 + 3 | 14 | 8/8 | 2/2 | 26/26 |
| foot w6 stone, **natural dirt in 2 of its cells** | 51 (11 s) | 44/44 + 3 (the dirt dug, the bridge's blocks in place) | 2 | 8/8 | 4/4 | 44/44 |
| arch w15, banks 0/0 (r3, final code) | 217 (40 s) | all | | 8/8 | yes | yes |
| trestle w18 timber, banks 2/0, 1 islet (r3) | 155 (30 s) | all | | 8/8 | yes | yes |
| foot w3 stone + natural dirt (r3) | 30 (7 s) | all | | 8/8 | yes | yes |
| covered w10, banks **0/1** (r3) | 218 (38 s) | all | | **4/8**: out-bound walks found no path (the step up to the 1-high far bank is under the portal's tie beam) | 3/3 | yes |
| **K1 crafting** | stone_brick_stairs 4, slab 6, wall 6, deepslate_brick_stairs 4, cobbled_deepslate_wall 6, polished_deepslate 4, iron_nugget 9, lantern 1 | | | | | |

**Totals:**

- 14 bridges, 2,102 blocks placed by the bot, 0 misses.
- **One finding, fixed in the rule:** a covered bridge with banks 0/1 cannot be walked out over the 1-high bank, because the tie
  beam blocks the jump. `stylesFor` now offers the covered bridge only on two equal banks, so the floor is flush at both portals.
  Every other case crossed 8/8.
- Every cell in its state, including 590 oriented cells. Stair facings were checked in all four directions and both halves; slab
  types, log axes on all three axes, and hanging and standing lanterns were checked too.
- 108/112 crossings arrived dry. The 4 that failed are the covered 0/1 case above; none fell in the water.
- 0 deaths.

**Not proven on Paper:**

- The whole expedition flow end to end on a real town: the kit's town draw, the lease, the walk out. That flow is bridgepost-01's,
  which is proven and live. The new code feeds it a different plan.
- Two builders at once: the lease prevents it.

## 6. Tests, tripwire, review

- `bots/test/bridges-design.test.mjs`: 11 tests.
  - Every style × bank (0..2 each side) × axis (4) × width (1..40) × islets × seed is solved and checked click by click: the
    reference already stands, the face leads into the cell, it is in reach, never in the builder's body, never in the walkway's
    headroom, the stair's yaw is its facing, the half is set by face and cursor, the log's axis is the face's, and a hanging
    lantern is only under a full block. Over 300 plans.
  - The choice by shape and by stock; the seeds.
  - The simulated build: it finishes, and an interrupted build resumes.
  - A misoriented own block is dug and replaced. The mutant without the fix cannot finish.
  - Natural ground is cleared; a chest refuses the build.
  - Islets; ice.
  - The index: a design excludes a material (the mutant lets them mix); nodesign; traffic bot-days.
  - The reservations, which cover every design cell.
  - The crossing watch and the traffic thresholds (the mutant with 1 bot-day sites one bot's day).
  - The reference-face rules (fence mutant).
  - The wiring: the design is named before the first block, plus the switches, the kit and the traffic siting.
- `bridgepost.test.mjs`: its anchors moved with the code. It passes 17/17, and woodworks, expedition and expwater pass too.
- **Tripwire** (main `docs/reports/shop-01-2026-10-25/shopread.py.txt`, branch `shopread-bridges01`):
  - `read_bridges` now also guards a designed site's `cells` (its first design line) from the site's first sighting.
  - Selftest: the design's cells guard. A later design line, a line for no site, a state with no design and malformed keys add
    nothing. Two anchored mutants are KILLED (no design cells; the last design line wins).
  - It must be installed before staging, or the tidy may dig a designed bridge's ramp without a trip.
- Reviews: Codex, blockers only (see §8).

## 7. Showcase plan, read, rollback

- **Stage:** `bridges-01show` after (or with) the wood batch: fences-01, plus boardwalk-01, with the tripwire `wood` rule. It
  supersedes boardwalk-01's plain plank bridges wherever a design fits:
  - a new site tries a design first;
  - planks are used only when no design fits and the logs are surplus;
  - otherwise cobble.

  Install the tripwire's design-cells guard first.
- **Expected on the showcase:**
  - Traffic sites: the N shore footbridge (26 + 63 crossings) and the W shore trestle.
  - The SW strip is refused (`no_fit`, recorded once a day).
  - The arch waits for brick stock: an 18-wide arch needs ~265 bricks against 214 above the keep. stoneworks-02's bills raise it.
- **Read** at +2 h and +24 h:
  - `op=bridge_site src=traffic` (ok=1/0 and why);
  - `op=bridge_pick ... style=`, `parts=`, `short=`;
  - `op=bridge_design ok=1 cells= clear=` (or `ok=0 why=`);
  - `op=bridge_place ok=0` share (over 10% is a defect, as bridgepost);
  - `op=bridge_build stop=` and `op=bridge_done ... mat=design:<style>`;
  - `bridge_broken` = 0;
  - the crossings file growing (`cross` lines);
  - deaths and `wet` stops near a site;
  - the chunky render of the site.
- **Rollback:**
  - `BRIDGE_DESIGN=off`: no new designs; a designed site not yet finished is left standing and reserved.
  - `BRIDGE_TRAFFIC=off`: no watch and no traffic sites.
  - Or activate the previous release.

## 8. Fleet port (not built)

The fleet has no expedition code at its tip, and no bridges at all. A port needs:

1. A **siting path that is not the expedition**. The fleet's crossings are near town (66-127), so the traffic site plus a "bridge
   visit" skill that walks to the near end can stand alone. The picker or sink offers it as a town project: one builder, the same
   lease.
2. The **crossing watch** in the fleet's features install, with the crossings file in each pool.
3. The **kit** against fleet stock. Logs are plentiful there, so covered and timber trestles will lead.
4. The **tripwire / fleet read** for the new rows, and an `effect` field for the registration. Candidate metric: swim samples
   within 8 of a built site, falling.
5. **Tier 2** (not protected): a fleet rollout, owner-direct, with a 60-min tripwire.

Candidates measured above:

- hive-d: an arch w 21, a trestle w 29, an arch w 9;
- hive-c: an arch w 12;
- a covered bridge wherever both banks are level with each other. The fleet's lakes hold 2,718 bot fill blocks; boardwalk-03's
  clean-up, or a fill rule, would free more covered sites;
- placebo-b: footbridges;
- the shared-seed river: footbridges.
