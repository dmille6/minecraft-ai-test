# Fresh-world town playbook (design only, 2026-11-06)

**Owner, 11-06, verbatim:** "in the future, when a new world is started fresh, should we block out the town area and get the bots
to first level ground, fill in holes, cut down trees, and terrace hills and mountains, then build town buildings and walls?" Then:
"yes, we can plan the fresh world plans, but continue with our current world for now".

**Status:** design only. No bot code changed, nothing deployed, no queue edits, no reseed (the standing rule: no fleet reseed,
one world in reserve). Ledger row `freshworld-1106`; memory `owner-freshworld-1106.md` (the owner's ask) and `freshworld-1106.md`
(this design).

**Short answer: yes, but not as "prep everything, then build".** Block out the whole town on day 0 and reserve it. Then prepare
the ground **one step ahead of the build order**, so the first building starts after about 13 bot-h, not after about 60.
Hills become terraces. Trees inside the plan are felled and replanted in the managed forest. Groundskeeping runs forever after.
The measured case for it: today a project sites itself when its turn comes, on ground the bots have spent days wrecking. That is
where most of the no_site stalls, the unroutable paths and the rework come from.

## 1. Measured: what goes wrong today without it

Reads: `scripts/lib/telemetry.py` full walks, nice 19, main's lib shipped to a temp dir on each host and removed after. Fleet
(10.0.0.31): 24 h, 11-05 15:30Z to 11-06 15:30Z, 1,673,208 rows, 80 of 80 bots, 24.04 h = 1,923 bot-h, fleet `47b8342d` /
`cab8abcf` (and the gkforever-01 canary on placebo-a and board-c). Showcase (10.0.0.40): 48 h, 11-04 15:35Z to 11-06 15:35Z,
745,898 rows, 15 bots, 720 bot-h. Record files: `/var/lib/mcai/_pool-*/project-*.g*.json` on each host. Script and outputs:
[`freshworld-playbook-2026-11-06/`](freshworld-playbook-2026-11-06/) (`measure.py.txt`, `fleet-24h.txt`, `showcase-48h.txt`).

### 1.1 Building is a small share of bot time, and most visits change nothing

| | fleet 24 h | showcase 48 h |
|---|---|---|
| build visits | 3,799 visits, 63.3 bot-h (3.3% of 1,923) | 2,809 visits, 46.4 bot-h (6.4% of 720) |
| visits that placed and cleared nothing | 2,864 (41.8 bot-h) | 2,563 |
| positive control | monument 3,556 placed; tidy 1,400; wall 508 | wall extension 602 placed; storage hall 225 |

### 1.2 no_site: projects that cannot find ground

- **Four fleet towns are blocked behind an unsitable project.** `_shop_skip why=no_site` gave 589 rows, all in exactly 4 of the 16
  pools: board-a 168, board-c 142, hive-c 123 and placebo-d 156. The other 12 pools had none. The `_project_unsited` rows (one a
  town, 10:20-10:29Z) say why:

  | town | project | refusals |
  |---|---|---|
  | board-a | monument | "no ziggurat site": 190 candidates refused for `furniture` (chests and tables left round town), 12 `avoid:project` |
  | placebo-d | monument | 476 `liquid`, 7 `no_ground` |
  | hive-c | monument | 144 `liquid` |
  | hive-c | house1 | "no proven site": NE, E, SE all 0 fits |
  | board-c | shop | "no proven site": every orientation 0 fits |

  Visits ending `no_site`: monument 72 (board-a 31, placebo-d 40, hive-c 1), house1 23 (hive-c), shop 20 (board-c).
- **The ground gets worse every day the town is unplanned.** This was measured on 10-13, on region copies against the seed terrain
  regenerated on Paper (`townground.mjs` header):
  - within 15 blocks of home, the bots had removed 9.0 blocks a column since the world began, 3.4 times the rate at the 35-48 ring;
  - the junk-well site rule failed in 13 of 16 towns;
  - the same search on the untouched seed terrain found a site in 16 of 16 towns: 95-340 valid caps on day 0, and 0-7 by days
    16-24 in the same worlds.
- **The showcase workshop plot X1** was reserved in the wall extension (11-04). It read `no_site` until 11-06 02:03Z. First,
  spruce trees stood on it and were never felled (plotprep-03). Then a sealed cave pocket under the grass, at 21,65..68,-65, could
  not be reached by any earth fill (levelfall-01 made the proof fall back to the next floor). The cottage and the town hall waited
  behind it: in 48 h, `site_wait` 11 visits (cottage1) and 13 (townhall).
  - The live logs still hold its `no_site` rows hourly from 11-05 15Z to 11-06 01Z, then `op=sited` at 02Z. The earlier rows come
    from the batch-10 read (memory `owner-showcase-work-1103`).
  - Other showcase `no_site` visits in 48 h: storage hub 44, decor 7, dress 6, shrine 5, road 5, wall extension 3.

### 1.3 Paths: 13 of 14 fleet towns route nothing

These are the latest `project-<home>.paths.g*.json` in each pool. 14 of the 16 pools have a paths record (board-c and hive-c never
reach the paths: their shop and house are unsited).
- **13 of 14 read `state=no_site`, `structure_complete=true`, 0 cells,** with `why=unrouted: shop / shaft / house1 / well:
  unreachable`. Being marked complete lets the order move on to the wall.
- The positive control is board-b: g6 `complete`, 320 cells, after 4 no_site generations. It is walked about 281 bot-min a day
  (projectaudit 11-06).
- The cause was measured on 11-01 (`paths.mjs` / `tidy.mjs` headers):
  - the bots pillar and pit their towns, so 34-40% of 4-adjacent ground columns differ by 2 or more (the showcase: 14%);
  - the router allows fill and cut of 2 or less, and cuts only natural ground, so it routes no leg.
- The gkforever-01 canary's interior audits today read `rough=3982/8066` (board-c, 49%) and `3290/8230` (placebo-a, 40%).

### 1.4 Trees growing into builds

| | count | out of |
|---|---|---|
| fleet build `clear_failed kind=tree` | **8,100** | 9,045 build failure rows (24 h) |
| of which isolated-c monument (3 leaf/bamboo cells) | 7,610 | 349-580 an hour, until canopy-01 (stuckproj-01) from 05Z 11-06 |
| of which placebo-b tidy (oak_leaves 271,64,-370, `no_stand`) | 490 | 245 `blocked` visits |
| tree-material clears that succeeded inside fleet builds | 2,158 | monument 1,654, wall 370, tidy 125, shop 9 |
| tree-material clears inside showcase builds, 48 h | 1,048 | wall extension 461, storage hall 312, workshop 112, tidy 91, stepwell 46 |
| showcase in-wall tree farm harvests | **0 of 245** | its own keep-out forbade felling its trees (forest-01 design); retired |

### 1.5 stuck_on_cell by project kind

- **Fleet:**
  - `_shop_skip why=stuck_on_cell` gave 795 rows in 8 towns: isolated-a 206, hive-b 150, placebo-b 131, placebo-c 128, hive-d 93,
    isolated-c 51, hive-a 32 and board-a 4.
  - Visits ending `stuck_on_cell`: monument 23, wall 7, tidy 2. Build-op `stuck_on_cell` rows: monument 122, tidy 60, wall 16.
  - Dead tidy cells: board-d 239 and placebo-b 245 `blocked` visits; hive-d 249 `attempts_spent` on one fill.
- **Showcase, 48 h:**
  - visits ending `stuck_on_cell`: hall 17, tidy 11, house1 6, dress 5, tower 3, monument 2, storage hub 2, paths 1;
  - `_shop_skip why=stuck_on_cell`: 249.
- Most of these are being closed one by one by phase 2: buildretry-01, buildnext-01, tidydead, canopy-01 and fellfirst-01. A
  fresh-world plan removes their **inputs**: the trees, leaves, pits and caves in footprints.

### 1.6 The only fresh-start town: the showcase timeline (record files)

The showcase started from bare ground. Its records give this sequence:

| date | event | cells |
|---|---|---|
| 10-26 | shop | 254 |
| 10-29 | house; ziggurat | 191; 4,889 |
| 10-30 | paths | 567 |
| 10-30 to 10-31 | wall (19 h) | 941 |
| 10-31 | tree farm, **inside** the wall | |
| 11-01 | storehouse | |
| 11-03 | tidy | 1,383 |
| 11-03 | yard; stair shaft | |
| 11-04 to 11-05 | storage hall: no room inside the ring, so it sited **outside** the wall | |
| 11-05 | wall extension | 628 |
| 11-05 | demolition of the old wall line | 114 blocks |
| 11-06 | enchanting workshop (X1), after the cave and trees above | |

That is a wall built before the town knew its plots, extended 5 days later, with part of it torn down. It is also a tree farm sited
where it could not work, and a workshop plot that waited about a day and a half on ground nobody had prepared. Each one is a
rework cost a day-0 plan avoids.

### 1.7 Rates used for the estimates

- Showcase rates (stepwell design, 4 days of visits):
  - stair visits dig 3.6 blocks a minute;
  - the tower sink places 5 a visit-minute;
  - walking and checking add 30-60%.
- Fleet in-visit throughput on visits that did something, 24 h: monument 3,556 placed in 12.9 bot-h (276 an hour), tidy 1,400 in
  5.9 (237), wall 508 in 1.5 (340). This agrees with the rates above.
- A spruce is about 6 logs and 57 leaves. Walking past one picks up about 1.5 saplings (forest-01 Paper proof).

## 2. Claude's design

### 2.1 The phases (each has an entry gate, an exit gate and the record it writes)

| # | phase | entry | work | exit | writes |
|---|---|---|---|---|---|
| F0 | **Bootstrap** | world day 0, bots spawned | logs, planks, a table, stone tools, a chest, food (peaceful: little). **No terraforming, no digging inside the candidate area.** | every bot has a stone pickaxe and axe, 64+ logs in total | nothing new (found-01 places the first chest, table and furnace when the plan exists) |
| F1 | **Site choice** | before F0 ends (a host tool, no bot time) | score candidate homes within ~300 blocks of spawn on an **offline copy of the seed's terrain** (the region-copy practice of 10-13 and 11-01) | one home chosen, and a second-best kept | `town-site.json` home (operator config, not a world edit) and `freshsite-<seed>.json` (the scores) |
| F2 | **Block-out** | the home is known | write the **whole** plan at once: `townplan` ring@1 (plaza, store, workshop, well edge, farm ring), the land plan (ring road, spokes, zones), **every** building plot sized for its blueprint plus a growth margin, the wall line **outside** the outermost plot, the managed-forest strip and the quarry (borrow pit) outside the wall, and a park | the plan and its reservations are published, and no other project may site inside them | `project-<home>.town` / `.land` / `.plots` (the existing records), with plot state `reserved` |
| F3 | **Prep ahead, in build order** | the block-out is published | the prep queue (§2.4): the plaza and the first 3 plots (junk well, workshop, storehouse), then the wall corridor, the roads, then each next plot. Fell (and replant in the forest strip), clear plants, cut high, fill low (cobble core, dirt top), **open and fill any cave under a plot floor**, terrace slopes | a plot reads `prepared`: its own proof passes (`buildsite`/`proveBuild`), and a stand reaches every cell | plot state `prepared`, then `handed` |
| F4 | **Build on prepared ground** | the next plot in build order is `prepared` | the existing projects, sited **only** on their plot (no free search) | the plot's project is complete | the project record, as today |
| F5 | **Groundskeep forever** | the first plot is handed | gkforever: the interior audit every 30 min, dead cells carried for 24 h, bands outward to 128, decoration | never | tidy and grounds records, as today |

F3 and F4 overlap: **prep runs one or two plots ahead of the builders.** That is the change from "prep everything first". The
owner's "first level ground ... then build" holds plot by plot, never as a town-wide wait.

### 2.2 Site choice (F1): what the score counts

The scorer reuses the plan fit (`townplan` ring@1 fit), the paths router (`paths.mjs` routeLeg/pathGrid) and siteprep's
earth classes (`prepClass`). It scores each candidate home on a 16-block grid near spawn:
- **Earthwork:** cut + fill (in blocks) to bring every plot and road to a TERRACED target (§2.3), with fill weighted 1.5 (it
  needs material that the cut may not supply).
- **Water:** water columns inside the wall line. Hard limit: none under a plot or the plaza. A river or lake beside the town is
  a bonus (the owner allows boats and bridges).
- **Cliffs:** adjacent drops of 4 or more inside the plan. The terraces can absorb 1-3; 4 or more means retaining walls.
- **Caves:** air or cave_air 1-6 below any plot floor. Open caves count double, because they need opening and filling (the X1
  lesson). This is read from the copy, since the surface hides it.
- **Trees:** the trunk count inside the wall line (labour, and saplings for the forest).
- **Features kept:** a hill or mountain beside or inside the ring that terraces rather than flattens scores **positively** (the
  owner wants hills kept), up to a relief limit.
- **Reachability:** the ring road routes under the tidy GRADE allowance, and every spoke reaches the wall line.

The scorer picks the cheapest site that passes the hard limits. Rough budget: total earthwork of 6,000 blocks or less, no plot
over siteprep's 200 cut / 400 fill, and zero water in plots. The second-best is kept for a re-plan.

### 2.3 Terracing, never flattening

- Each plot gets its OWN floor: the median ground under it, rounded toward the cheaper side. It is never one plane for the whole
  town (the owner's 11-03 terrace rule; landplan stage 1).
- Between plots and roads, the ground steps by 1 or less on walkable edges, and a step of 2 or more gets a stair or ramp. A
  slope steeper than one block in one becomes **terrace treads**: rings of +1 a tread, at least 2 wide, following the contour.
- **Hills outside the plots are kept.** Their columns are cut only where a road or plot needs it, and never by more than the
  terrace rule needs. A "keep" mask from F2 marks hill and mountain columns, and a cut there must name its road or plot.
  Inside the wall, a hill can become the park or a terraced garden instead of a plot.
- Fill: a cobble core with a dirt top (grass spreads back), and the cut and fill balanced inside each plot first. The deficit
  comes from the quarry outside the wall (cobble), never from inside the plan.
- Water stays the owner's last resort: no plot is placed on water (F1 rejects it), so F3 fills water only for a road crossing
  with no dry route. Bridges are preferred there (bridgepost-01).

### 2.4 The prep queue and who works it (5 bots)

- **The queue** is derived from the plan in build order:
  1. P0: the plaza and its stands;
  2. P1: the junk well;
  3. P2: the workshop;
  4. P3: the storehouse;
  5. P4: the wall corridor, in segments;
  6. P5: the ring road and the gate spokes;
  7. P6 onward: each later plot in build order (house plots, hall, yard, farms, ziggurat, the stair shaft's head).
- **Look-ahead 2:** prep may work at most 2 plots ahead of the first plot no builder has started. Prep never runs town-wide while
  the builders wait.
- **Crew** (it flexes by what is open):
  - F0: all 5 bots.
  - F3 and F4: 2 preppers (the keeper and a helper, gkforever's crew), 2 suppliers (quarry cobble and dirt, wood, which also
    means felling the forest strip), and 1 builder from the first `prepared` plot on.
  - A prepper with nothing prepped-and-open turns builder. A builder with no prepared plot turns prepper. Nobody idles on a
    `site_wait`.
- **Day-0 litter discipline:** escape pillars, stray tables and chests inside the plan are removed the same visit, or by the
  keeper's next audit. board-a's 190 `furniture` refusals came from this.

### 2.5 Time estimate for a 5-bot town (bot-hours)

Rates: digs 3.6 a minute, placements 5 a minute, plus 45% walking and checking (§1.7). Volumes: the showcase's records and the
siteprep plot caps. Plains or taiga ground about 14% rough, as on the showcase.

| step | volume (assumed) | arithmetic | bot-h |
|---|---|---|---|
| F0 bootstrap | 64 logs, tools, chest | measure in the sandbox; assumed 0.6-1 an hour a bot | 3-5 |
| F1 site choice | host tool | 0 bot time | 0 |
| F2 block-out | records; optional corner markers | | 0-0.5 |
| F3 plaza + 3 first plots | 4 plots x (100 cut + 200 fill) + 10 trees (60 logs, ~200 leaves) | (400+260)/3.6 + 800/5 = 343 min x 1.45 | **8.3** |
| F4 first 3 buildings | junk well, workshop ~500, storehouse ~100 | ~700/5 = 140 min x 1.45 | 3.4 |
| F3 wall corridor | ~280 columns x ~1.5 ops | 210/3.6 + 210/5 = 100 min x 1.45 | 2.4 |
| F4 wall | ~940 cells | 188 min x 1.45 | 4.5 |
| F3 roads | ring road + spokes, ~570 cells | grade ~600 ops + pave 570 | 5 |
| F3 remaining plots | ~8 plots x ~300 ops | 1,000/3.6 + 1,400/5 = 558 min x 1.45 | 13.5 |
| F3 terraces on hills inside the wall | 1,000-4,000 digs (the stepwell: ~3,800) | 1,000/3.6 to 4,000/3.6 x 1.45 | 7-27 |
| F3 trees inside the wall line | plains ~10, forest ~150 | 2-3 min a tree | 0.5-7.5 |
| F4 the rest (house, hall, yard, ziggurat 4,889...) | ~7,000 cells | 1,400 min x 1.45 | 34 |

- **Prep in total: about 37-64 bot-h. Construction: about 42 bot-h.** Ground prep is about as much labour as the buildings.
- **Time to the first building:** F0 + F3's first block is about 11-13 bot-h. That is about **5-7 h of wall clock** with 5 bots at
  40% of time on work, against today's productive share of 18.5% (fleet).
- **The whole town at 40% work share:** 80-110 bot-h, which is 40-55 h of wall clock. The showcase took 5 days to the first
  wall, and was still reworking on day 11.
- These are estimates from showcase rates. The sandbox run (§5) replaces them with measurements.

### 2.6 What the playbook does NOT do

- **No town-wide flatten,** and no "prep everything before building" gate.
- **No admin edits:**
  - the site is chosen by reading an offline copy;
  - the home is set in operator config (`town-site.json`), as today;
  - every block is placed or dug by a bot.
- **No reseed of the current worlds.** For the current world, the reusable parts are: the scorer, which ranks expansion plots;
  the plan-wide reservation; and "prep one ahead", which generalises siteprep.
- No LLM in geometry. The mayor may later choose only inside the plan, as in landplan.

## 3. Codex's independent design

Codex wrote this with `codex exec -s read-only`. It was given the owner's question, the owner's rules, the evidence in section 1,
the list of existing pieces and the phase-3 plan, but not this design. Its brief and its full text are in
[`freshworld-playbook-2026-11-06/`](freshworld-playbook-2026-11-06/) (`codex-brief.md`, `codex-design.txt`). In short:

1. **Survey and choose in the world.** Two bots scout, two gather, and one surveys the core, within a bound of one bot-hour.
   - Codex scores whole layouts, not single footprints.
   - It hard-rejects unknown foundations, conflicts, unreachable work faces and layouts over the earthwork limit.
   - It ranks the rest:
     1. zero water change;
     2. labour, cut/216 + fill/300 + tree clears/216, times 1.3-1.6;
     3. travel, canopy and maintenance;
     4. connected plots and features kept.
   - Underground cells it cannot read stay unknown.
2. **Reserve before founding.** It reserves exact 3-D boxes for every plot, the roads, the gates and the approaches, including the
   canopy, the working stands and scaffold space. It also reserves expansion plots X1-X5 at real blueprint sizes, a wall corridor
   (built later), and the forest outside it. Reservations forbid unrelated work, but allow the plot's own prep and build tasks.
3. **The first working district.** The prep order is the forest's replant cells, then the trees, the access corridor, the workshop
   and storage pads, the house, and the next plots.
   - Saplings are reserved before felling, with one outside replant per tree, recorded.
   - A tree with no proven access is kept, and the pad is re-sited.
   - siteprep's limits are maximums, not targets.
   - The district gets 8 prep bot-h, then a re-plan.
   - Cuts go top-down and fills bottom-up. A sealed cave needs an explicit open, fill and close sequence, or another pad.
   - Each plot is ready on its own physical check of foundation, clearance, access and return route.
4. **Build while prepping ahead.** The crew is 2 builders, 1 keeper (preparing at most 2 plots ahead), 1 supplier and 1
   forest/logistics bot.
   - **Explicit dependencies replace the PROJECTS order.**
   - The wall closes only once the essential places and the expansion plots fit inside it (no early wall to demolish later).
   - **A blocked route is never "complete" with zero cells.**
5. **Maintain forever.** The default stays 2 / 1 / 1 / 1. A second keeper is added only for a while, when repairs threaten
   access. Other rules:
   - the interior is audited every 30 min and after escapes;
   - escape blocks are restored from provenance records;
   - the LLM picks only among eligible tasks.
6. **Budget.**
   - Survey and founding: 1-2 bot-h.
   - 300 cut + 900 fill: 5.7-7.0 bot-h.
   - 12 trees, with leaves cleared by hand: 4.6-5.6.
   - Essential buildings (1,800 placements): 7.8-9.6.
   - Wall: 4.1-5.0.
   - Ziggurat: 21-26.
   - Totals: the essential district 19-24 bot-h; with the wall and the monument, 44-55.
   - At the fleet's 3.3% build share, 19-24 bot-h stretches over 115-145 elapsed hours, **so scheduling is part of the design.**
7. **Reuse** townplan/found, buildsite proofs, paths geometry, tidy records, townground, and the showcase's landplan, plotprep,
   siteprep, terrace, canopy, fellfirst, stepwell and forest pieces.
   - Extend no-dig protection to reserved pads and corridors.
   - Add terrain anchors, provenance, readiness certificates and labour budgets.
   - **Tighten the terrace's water handling to last-resort semantics** (the existing terrace stage allows some water fills).
   - Back off after 3 unchanged failed visits.
8. **Proof.** Paired fresh Paper worlds on 6 seeds (plains, forest, hills, mountains, water, hidden caves), 5 bots, peaceful,
   72 h against the current scheduling, then a 7-day soak. The pass criteria:
   - the essential district works within 24 h;
   - no town is blocked behind one project;
   - every route is walked both ways;
   - no reservation breach, no flattening, no undocumented water fill;
   - one replant per felled tree;
   - 3 forest rotations;
   - less than 10% of time in repeated unchanged visits;
   - no worsening terrain damage.
9. **Phase 3:** the work board first, then the shared geometry/readiness registry, then the body lease, then the showcase ports.
   Prototype the bounded planner now. Do not add another permanent scheduler inside `skills.mjs`.

**What Codex would NOT do:** clear the whole town radius, flatten mountains, fill ponds for convenience, keep the in-wall
production forest, let prep run forever, use admin edits or teleports or rails, or reseed the current worlds.

## 4. Reconciliation

The two designs agree on the shape: reserve the whole town first, prepare a plot or two ahead of the builders, terrace and
never flatten, and groundskeep forever. Both reject a "prep everything, then build" gate, and neither changes the current worlds.
The differences, and what we chose:

| question | Claude | Codex | chosen, and why |
|---|---|---|---|
| **site survey** | an offline copy of the seed's terrain (a sandbox regenerates it, as on 10-13), scored by a host tool | in-world scouts, within 1 bot-h; unknown underground stays unknown | **Both, offline first.** The offline copy is the only source that sees caves under the grass (the X1 lesson) and costs no bot time. It is a read, not an edit; the home goes into `town-site.json` as today. Then 1 bot walks the top 2 candidates in the world to confirm (the copy and the world must agree: §5 S0). With no seed copy, fall back to Codex's in-world scout |
| **site score** | earthwork (fill x1.5), water, cliffs, caves, trees, features kept as a bonus, ring-road routability | ranked in order: water first, then labour (cut/216 + fill/300 + trees/216, x1.3-1.6), then travel/maintenance, then features | **Codex's ordering, with Claude's terms in it.** Water is a hard rank, then labour in bot-h (Codex's rates, which are the measured ones), then the cave, cliff and route terms. Labour in bot-h is easier to check against the sandbox run than "blocks" |
| **the wall** | corridor prepped 4th, wall built after the first 3 plots | corridor reserved on day 0, the wall closed **only** once the essential places and expansion plots fit | **Codex.** The showcase's wall went up on day 5, then needed a 628-cell extension and a 114-block demolition. In a peaceful world the wall is decoration plus a boundary: build it after the plan's plots are final |
| **crew of 5** | 2 preppers, 2 suppliers, 1 builder, flexing | 2 builders, 1 keeper (2 plots ahead), 1 supplier, 1 forest/logistics | **A phased mix.** First district: 2 prep + 1 build + 1 supply + 1 forest. After it: Codex's 2 / 1 / 1 / 1, with a second grounds slot only while a repair backlog threatens access (gkforever's cap of 2 is the ceiling, not the default). Rule from both: no one idles on `site_wait`; a prepper with nothing to prep builds |
| **order** | a prep queue P0..Pn in build order, look-ahead 2 | **explicit dependency graph** instead of the PROJECTS order; forest replant cells before felling | **Codex's dependency graph**, which is also phase 3.1's work board. The prep queue is the graph's "prepare" tasks. The forest's replant cells come before any felling (saplings reserved first) |
| **trees with no stand** | fell everything in the plan | keep an inaccessible tree and re-site the pad | **Codex.** 7,610 + 490 failed clears in 24 h were exactly the "fell it anyway" loop. The plan has slack; a pad can move |
| **prep budget** | caps per plot (siteprep's 200/400) | the same caps as maximums, plus 8 prep bot-h for the first district, then a re-plan | **Codex's budget.** It is the guard against "prep never finishes" |
| **route completeness** | (implicit) | a blocked route is never complete with 0 cells | **Codex, made a rule.** It is the 13-of-14 `no_site` + `structure_complete=true` pattern. On a fresh world, a route that cannot route is a prep defect to fix, not a project to mark done |
| **water** | no plot on water; fill only for a road crossing with no dry route, and prefer bridges | tighten the existing terrace stage's water handling to last resort | **Both.** Codex found that the showcase terrace stage allows some water fills. It must be checked against the owner's last-resort rule before reuse (piece B4) |
| **estimate** | first building after 11-13 bot-h; prep 37-64, construction 42, the town 80-110 | the essential district 19-24; with the wall and ziggurat 44-55 | **Consistent:** different scopes, the same rates. Codex prices the starter district; Claude adds the remaining plots, the roads, the hill terraces and the forest-biome trees. Both say the build share (fleet 3.3%) dominates elapsed time |
| **proof** | one seed, paired | 6 seeds, paired, 72 h + 7-day soak | **Staged** (section 5): 1 seed first, then 3, then the soak on the reserve world when the owner opens it. Six paired 72 h runs is 12 sandbox runs of 5 bots, more than the sandboxes take this month |
| **escape litter** | removed by the next audit (tidy pillars) | restored from provenance records | **Codex, later.** Provenance (who placed this block, and why) is new instrumentation; tidy's spoil rule covers most cases until then |

## 5. Order of operations for a 5-bot town (reconciled)

| step | what | crew | bot-h (est.) | gate to the next |
|---|---|---|---|---|
| S0 | (host, before the bots) regenerate the seed's terrain in a sandbox; score candidate homes; set `town-site.json` | none | 0 | a site passes the hard limits |
| F0 | bootstrap: wood, stone tools, chest, food; 1 bot walks the top 2 sites | 5 | 3-5 | tools for all; the confirmed site matches the copy |
| F2 | block-out: the town plan, the land plan, every plot (blueprint size + growth margin), the wall **corridor**, the forest strip, the quarry, the park, hill "keep" masks; all reserved | none (records) | 0-0.5 | reservations published |
| F3a | forest replant cells; then fell the trees on the plaza and the first 3 plots; plaza + junk well + workshop + storehouse pads; caves under them opened, filled and closed | 2 prep, 1 forest, 2 supply | 8-13 (budget 8, then re-plan) | each pad's own proof passes |
| F4a | build the junk well, workshop and storehouse on their pads, one by one as each is ready | 1-2 build | 3-4 | stations and storage reachable |
| F3b/F4b | prep 2 ahead / build: house, hall, yard, farms, then the civic plots; the ring road and gate spokes graded before the buildings they serve | 2 build, 1 keep, 1 supply, 1 forest | prep 14-25, build 15-20 | each plot ready and then built |
| F3c | terrace the hills inside the wall (treads on the contour, or a park/garden); the ziggurat's plot | keeper + helpers | 7-27 | no walkable edge steps more than 1 |
| F4c | the wall, once the plots are final; then the ziggurat (21-26 bot-h; Codex) | 2 build | wall 4-5 | wall closed with its gates |
| F5 | gkforever from the first handed plot | 1 keep (+1 while there is a backlog) | ongoing | never completes |

- **To the first building:** about 11-13 bot-h. With 5 bots at a 40% work share, that is about 6 h of wall clock.
- **The essential district** (Codex's scope): 19-24 bot-h.
- **The whole town with the terraces:** 80-110 bot-h.
- At today's fleet build share of 3.3%, the same work takes **about 3-4 times longer.** The phase-3 work board is the lever, not the
  earthwork code.

## 6. What exists vs what must be built

| piece | where it lives | role in the playbook | status |
|---|---|---|---|
| `townplan.mjs` ring@1 + `planstore.mjs` | main | F2: the core plots and their reservations | reuse |
| `found.mjs` | main | F0/F2: first chest, table, furnace into their plots | reuse |
| `landplan.mjs` + `groundskeeper.mjs` | showcase only | F2: ring road, spokes, zones, corridors, the outward stages | port to main (phase 3.4) |
| `siteprep.mjs` (01-03) | showcase only | F3: grade a plot, with caps and earth/water/hard classes; requests filed on `no_site` | generalise: filed by the plan **ahead**, not only after a `no_site` |
| plotprep-01/02 | showcase only | F3: the keeper readies reserved plots; a plot a project sites on mid-prep is retired | reuse |
| levelfall-01, canopy-01 (main), fellfirst-01 | showcase / main / showcase | F3: proof falls back a floor; fell the canopy over cells; fell before building | reuse |
| `tidy.mjs` + gkforever-01 | main + canary | F5: the never-ending audit, dead cells carried 24 h | reuse (canary reading now) |
| forest-01 | ready to stage (showcase), fleet branch | F3a: the replant destination; rotation | reuse |
| stepwell / townterrace | showcase | F3c: terrace geometry, treads | reuse the geometry; **check its water fills** (Codex) |
| `paths.mjs` router, tidy GRADE | main | S0 score (routability), F3b roads | reuse |
| `buildsite.mjs` proofs | main | the readiness check | reuse |
| `townground.mjs` no-dig zone | main | extend to every reserved pad and corridor (Codex) | extend |
| phase-2 stall fixes (buildretry/buildnext/buildwait) | fleet canaries | the 3-unchanged-visits back-off | reuse |
| **B1 `freshsite` scorer** | new: a host tool + `bots/scripts/freshsite-offline.mjs` on the existing fit/router/prepClass | S0 | build |
| **B2 day-0 block-out** | new: one writer that publishes all plots (blueprint envelopes + margin), the wall corridor, the forest, the quarry and the keep masks before any project sites | F2 | build (small: composes the existing records) |
| **B3 readiness + dependency graph** | new: plot states `reserved -> prepping -> prepared -> handed -> built`; projects site **only** on their plot | F3/F4 | build on phase 3.1 + 3.2 |
| **B4 terrace planner rules** | extend siteprep/landplan: per-plot floors, contour treads, the hill keep mask, water strictly last resort | F3c | build |
| **B5 cave seal** | new: open, fill and close a sealed cavity under a pad (X1), or re-site | F3a | build; a Paper proof first |
| **B6 fresh-world harness** | new: `sandbox/freshworld/` run script, metrics reader | the proof | build |
| B7 block provenance | new instrumentation (Codex) | F5 | later |

## 7. How to prove it (a Paper sandbox fresh-world run)

- **Where:** sandbox4 (10.0.0.30:25602), or whichever sandbox is free. Take its lock under `sandbox/` and release it. Paper 1.21.8,
  as the fleet. Peaceful, survival, 5 bots, the same model serving as the fleet, **no admin edits after the world starts** (the run
  script may set the gamerules and the spawn, then only the bots act).
- **S0 check (the offline copy matches):** regenerate the seed in a scratch server (`forceload` 7x7 chunks, `save-all flush`,
  stop, as on 10-13). Score it, and pick the site. On the live run, compare 200 random columns at the site once the bots have
  loaded them. They must be identical before any bot edits them.
- **Stage 1, one seed, paired, 48 h:** treatment (the playbook) against control (the current code, the same seed and start).
  Pick a mixed seed: taiga trees, a hill inside the would-be ring, a pond nearby. Pass if:
  1. no admin edits (the CoreProtect / RCON log shows only bot actions);
  2. the first building is placed within 12 h, and the essential district (workshop, storehouse, house, junk well) works
     within 24 h;
  3. 0 `no_site` and 0 `site_wait` longer than 2 h for planned kinds;
  4. every planned route has cells and is walked both ways (no `structure_complete` with 0 cells);
  5. inside the wall, walkable edges with a step of 2 or more are 5% or less (the showcase today: 14%; the fleet: 34-49%), and no
     cave air within 4 below any pad floor (a region read at the end);
  6. hills kept: the terrain volume above each plot's floor, outside the plots and roads, is 90% or more of day 0, and no summit
     column is lowered;
  7. trees: 0 inside the wall except the park, and outside replants at least equal to felled trees;
  8. repeated unchanged visits are 10% or less of build and prep time (Codex);
  9. no wall demolition and no plot re-siting after F2;
  10. deaths 0.
  Report the control's numbers beside them. The control is expected to repeat section 1 in miniature.
- **Stage 2, three seeds** (dense forest, mountain edge, water + caves), 72 h each, treatment only, with the same pass list.
- **Stage 3, the soak:** the next real fresh start (the reserve world), when the owner chooses to open it, read like a canary
  (+24 h, +72 h, 7 d).
- **Paper facts the design rests on** (to be proven in stage 1, not assumed):
  1. A regenerated seed matches the live world's terrain for the same Paper version and world settings.
  2. Leaves felled by hand vs left to decay: in the forest proof, decay took 4 min at random tick 60. At the live default of 3 it is
     about 20 times slower, so the prep must cut or wait.
  3. Sand and gravel fall when a terrace cut undermines them.
  4. Grass spreads back over a dirt-topped fill.
  5. A bot can place into a sealed cavity only from an opened face within reach. This is the B5 sequence.
  6. Spruce saplings planted 1 per felled tree regrow in the forest's sunk plots (forest-01: 24/24 at rtick 60).

## 8. Phase-3 placement

The playbook is a client of phase 3, not a fifth refactor. Recommended order:

1. **Now (no bot risk, low priority):**
   - B1, the `freshsite` scorer, as a host tool. It reads offline copies only. It can also rank expansion plots in the current
     world.
   - B6, the harness skeleton.
   - The stage-1 control run, which needs no new code: the current flow on a fresh seed gives the baseline.
2. **With phase 3.1 (the town work board):** B3's dependency graph becomes the board's task source. "Prepare plot X" and "build
   plot X" are tasks with back-offs and fairness. Do not build a separate prep scheduler in `skills.mjs` (Codex).
3. **With phase 3.2 (the shared project registry):** each kind supplies its blueprint envelope (for B2's block-out) and its
   readiness proof. One module owns plot states and completion, so "complete with 0 cells" cannot happen.
4. **After phase 3.4 (the showcase onto main):** landplan, siteprep, plotprep, levelfall, fellfirst and forest exist on main behind
   per-pool flags. Only then can B2 and B4 compose them on main.
5. **Then:** B2, B4 and B5, then the stage 1 and 2 sandbox runs, then the owner's decision on a fresh world.

Phase 3.3 (the body lease) is not a prerequisite. A fresh, prepped town produces fewer escape pillars, which helps it.

Queue view: nothing here enters the fleet or showcase canary lanes now. The current world continues as is (owner).
- **Claude:** B1 and the control run are host-side work, so they can go on the ops lane whenever a sandbox is free.
- **Codex:** "prototype the bounded planner now". This matches B1 + B2 as offline tools on a sandbox copy.

## 9. Owner decisions

1. **The site from an offline seed copy.** Choosing the town site by reading a sandbox-regenerated copy of the seed is a read, not
   a world edit. OK for a fresh world? (Recommended: yes. The fallback is in-world scouts.)
2. **The wall after the plots.** The wall is built after the plan's plots are final, not early (recommended; the showcase
   demolition).
3. **The stage-1 sandbox run.** Run it (48 h paired, about 10 bot-processes on a sandbox) once a sandbox is free, at low priority?

