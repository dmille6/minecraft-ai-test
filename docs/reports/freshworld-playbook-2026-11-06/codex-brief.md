You are designing, independently, a "fresh-world town playbook" for a Minecraft bot project (mineflayer bots on a Paper 1.21.x server,
peaceful worlds, 5 bots per town, deterministic JS project modules + a small LLM for idle choices). DESIGN ONLY: do not edit files.
You may read the repo (read-only) at the current directory: bots/src/*.mjs (townplan.mjs, tidy.mjs, paths.mjs, townground.mjs,
found.mjs, buildsite.mjs, treefarm.mjs, shop.mjs PROJECTS order, skills.mjs build visits), docs/reports/*.md.

OWNER QUESTION (11-06): "in the future, when a new world is started fresh, should we block out the town area and get the bots to
first level ground, fill in holes, cut down trees, and terrace hills and mountains, then build town buildings and walls?"
Owner then: plan it for future fresh worlds; keep the current worlds running (no reseed now).
Standing owner rules: bots changing the world is wanted; NO admin edits (no /fill, /setblock, /give, teleport, WorldEdit, world-file
edits); hills and mountains are kept as features and become TERRACES (steps <= 1 between walkable neighbours), never flattened;
filling water only as a last resort; swimming is travel; trees felled inside the town get replanted in a managed forest outside the
walls (being built: forest-01, neat rows, rotation); worlds stay peaceful; no rails. Goal: bots that build cool structures, survive and
cooperate over long periods.

MEASURED EVIDENCE (this world; fleet = 80 bots in 16 pools sharing several towns, showcase = 15 bots in one town that started from bare
ground on 10-26):
1. Fleet 24 h (11-05 15:30Z..11-06 15:30Z, 1.67 M rows, 80 bots, 1,923 bot-h): build visits 3,799 = 63.3 bot-h (3.3% of bot time);
   2,864 visits placed AND cleared nothing (41.8 bot-h). Showcase 48 h (720 bot-h): 2,809 visits = 46.4 bot-h, 2,563 placed nothing.
2. Unsitable projects: `shop_skip why=no_site` 589 rows in exactly 4 fleet towns (board-a 168, board-c 142, hive-c 123, placebo-d 156).
   Causes from the `project_unsited` rows: board-a monument "no ziggurat site": 190 candidates refused for `furniture` (bot litter:
   chests/tables), placebo-d monument: 476 refused `liquid`, hive-c monument: 144 `liquid`; board-c shop and hive-c house1: "no proven
   site" (every orientation 0 fits). A project that cannot site held the bot 24 h on that project (being fixed elsewhere).
3. Paths: the latest paths record in 13 of the 14 fleet towns that have one is `state=no_site, structure_complete=true, 0 cells,
   why=unrouted: shop/shaft/house1/well:unreachable`. Only board-b's routes (320 cells, walked ~281 bot-min/day). Root cause measured
   11-01 on region copies: the bots wrecked their town ground (1x1 pillars from escapes/climbs, pits from digging): 34-40% of
   4-adjacent ground columns differ by 2+ (showcase 14%), and the router (+-2 fill/cut, cut only natural ground) routes no leg.
   Also 10-13: within 15 blocks of home the bots removed 9.0 blocks per column since world start (3.4x the 35-48 ring); the junk-well
   site rule fails in 13 of 16 towns while the same search on the untouched seed terrain finds a site in 16 of 16 (95-340 valid caps on
   day 0, 0-7 by day 16-24). Sites get scarcer every day the town is unplanned.
4. Trees in builds: fleet 24 h, build `clear_failed kind=tree` = 8,100 of 9,045 failure rows (isolated-c monument 7,610 on 3 leaf/bamboo
   cells until a canopy fix 11-06 05Z; placebo-b tidy 490 on one oak_leaves cell, no stand). Tree-material clears that succeeded inside
   builds: 2,158 fleet (monument 1,654, wall 370), 1,048 showcase in 48 h (wall extension 461, storage hall 312, workshop 112).
   Showcase in-wall tree farm: 0 of 245 grown-tree harvests ever succeeded (its own keep-out forbade felling) and it was retired.
5. stuck_on_cell: fleet shop_skip why=stuck_on_cell 795 rows in 8 towns (isolated-a 206, hive-b 150, placebo-b 131, placebo-c 128,
   hive-d 93); visits ending stuck_on_cell: monument 23, wall 7, tidy 2; build-op stuck rows monument 122, tidy 60, wall 16. Showcase
   48 h visits ending stuck_on_cell: hall 17, tidy 11, house1 6, dress 5, tower 3. Tidy dead cells: board-d 239 + placebo-b 245
   `blocked` visits, hive-d 249 `attempts_spent` on one fill.
6. Showcase (the only fresh-start town) timeline from its records: shop 10-26, house + ziggurat (4,889 blocks) 10-29, paths 567 cells
   10-30, wall 941 cells 10-30..10-31 (19 h), tree farm inside the wall 10-31 (later retired), storehouse 11-01, tidy 11-03, then the
   storage hall had to site OUTSIDE the wall (no room inside), so a wall extension (628 cells, 11-05) was built and 114 blocks of the
   old wall demolished. The planned workshop plot X1 sat `no_site` ~11-04..11-06 02Z behind spruce trees and a sealed cave pocket
   (21,65..68,-65) under grass that no earth fill could reach; the cottage and town hall `site_wait` behind it (11 + 13 visits).
7. Rates (showcase): stair visits 3.6 digs/min, tower sink 5 placements per visit-minute; +30-60% walking/checking. Bags hold
   ~6,000 cobble across the town; labour, not stone, is the constraint. One tree ~ 6 logs + ~57 leaves; ~1.5 saplings picked up per tree.
   Typical town tidy records: cuts 45-70, fills 240-460 per pass. Ziggurat 4,889 blocks; wall ring ~940; storage hall ~600.

EXISTING PIECES (some on main, some only on the showcase branch): townplan.mjs (ring@1 template: plaza, store, workshop stations,
well edge, farm ring; reservations; founding places first chest/table/furnace into plots), landplan.mjs + groundskeeper.mjs (showcase:
ring road + spokes, zones per sector, stages outward to 80), tidy.mjs (pillars/pits survey, grading corridors, record), gkforever-01
(canary now: grounds never complete, interior audit every 30 min, bands to 128, 2 keepers/town), siteprep-01/02 (showcase: a project
with no site files a request; keeper grades the cheapest plot: cut/fill <= 6 per column, 200 cut / 400 fill per plot; water last),
plotprep (showcase: keeper readies reserved plots X1..X5), levelfall-01 (site proof falls back to next floor), forest-01 (managed
forest outside the walls), stepwell (terrace descent), townground.mjs (no-dig zone 16 round home), canopy-01 (fells canopy over cells),
fellfirst-01 (fell before build). A code evaluation (11-06) plans a "phase 3": (1) a town work board (towns publish tasks, bots claim,
per-project back-offs, fairness), (2) a shared project registry (each kind supplies geometry; one module owns ordering, visits,
stuck fixes, completion), (3) a body lease/escape controller, (4) showcase onto main behind per-pool flags.

DELIVER (plain text, <= 1,400 words): your own design for what a bot town should do from world day 0, as an ordered list of phases
with entry/exit criteria; the data each phase writes; how site selection should score candidates; what to reserve and when; how to
terrace without flattening; build order vs prep order; how many bots on what; time estimates in bot-hours for a 5-bot town with your
arithmetic; what of the existing pieces to reuse vs build; the risks (what could make this worse than today: e.g. bots idle while
prepping, the prep never finishing, prep wrecking ground) and the guards; how to prove it in a Paper sandbox fresh-world run (pass
criteria); and where it fits relative to the phase-3 refactors. Be concrete. Say what you would NOT do.
