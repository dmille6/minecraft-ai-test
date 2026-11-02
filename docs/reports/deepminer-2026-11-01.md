# The town deep miner (deepminer-01), 2026-11-01

OWNER 11-01 item 2 (memory `owner-showcase-next-1101`): the common town mineshaft ON in the showcase with a camera, and a
DEEP MINER job: 1-2 bots per town (soft preference, flexible jobs) go down the finished town stair to iron depth, then diamond
depth, branch-mine safely off its foot (probe lava ahead, seal fluids, torches, mark the way back), bank ores in town, and turn
diamonds into pickaxes. Owner 10-23 M7-M10, O6 (branches at feet y=-53), O7 (stair credit in the exit contract only for
deep-miner leaseholders), O11 (accept the stranded residual), O13 (single occupancy for the first diamond canary). Owner 11-01
~22:40Z: water buckets on lava are now allowed (supersedes M9) -- see section 7.

Tier 3 (protected: `mine`, `mineGuarded`, cognitive, admission, oretunnel, skills `deep*`, the new `deepmine.mjs`).

## 1. Do bots use the 11 finished fleet shafts today? (24 h to 11-01 ~22:00Z, full walk)

Positive controls: 1,854,023 rows, 80 bots, 24.0 h; 8,151 `mine` calls; 1,155 `_shaft` visit rows.

- **11 towns have a finished stair** (landings 48+32+16 built): board-a, board-b, board-d, hive-b, isolated-a..d, placebo-b..d.
  hive-a and placebo-a are stuck on `no_support` (42 and 29 visits), hive-d sited once, board-c and hive-c have none.
- **Descents through the stair: 131 arrived out of 1,163 attempts (11%).** 852 (73%) were refused before the walk because a
  step's air cell read `blocked`; 180 (15%) were walks that failed on a verified route.
  - The blocks are **dirt**. The region file of isolated-d (record g5, all three landings built) shows dirt in the air cells of
    steps 17, 23 and 52 (374,54,128 / 373,48,127 / 372,19,129); board-b, placebo-c and board-a read clean at the same moment
    (their repair visits had just run). The builder's visits keep repairing (458 `complete` visits in 24 h), the dirt keeps
    coming back, and the use refuses in between.
- **Ascents: 38 arrived out of ~711** (668 `no_plan`: the 4 s plan from depth to the collar does not find the route).
- `mine` calls: 1,896 of 8,151 are real descents (goal <= y-8); 4,055 ask for y <= 20.
- After the 131 successful descents (next 60 min per bot, overlapping windows): ~95 raw iron gained, **0 diamonds, 0 diamond
  attempts fleet-wide**; bags at window end: 0 diamonds, 0 diamond pickaxes, 73 iron pickaxes, 98 iron ingots.
- Depth reached: most descents stay at 14-24; a few `mine` on to -14 .. -51 afterwards (board-a, board-b, hive-b).

So the stairs exist and are used a little, mostly for iron at 16, and nothing goes to diamond depth. The two levers: the stair
must be walkable when a miner arrives (repair on the way down, walk it a hop at a time), and someone has to go deeper on
purpose with a kit and a way back.

## 2. The world's real ore distribution (region scan, read-only, 17 x 17 chunks round home, board-a / hive-c / placebo-d)

| | peak | best 8-block band | note |
|---|---|---|---|
| iron_ore | y 13-22 | 8..23 (2,600-2,800 per world) | the stair's y=16 landing is on the peak |
| deepslate_iron_ore | y -4 .. -13 | -16..-1 | |
| deepslate_diamond_ore | y -52 .. -59 | -56..-49 (1,093 / 832 / 1,339) | diamond_ore above 0 is ~1% of diamonds |
| lava | | 2,668-10,868 blocks at -64..-49 vs 37-309 at -16..-1 | the 1.18+ lava level: caves at y <= -55 are lava |

Feet y=-53 (owner O6) keeps the floor at -54, one block over the lava level, in the diamond band.

## 3. Design

A **job**, not a model choice: `deepmine.mjs` decides (pure, tested), `skills.mjs deepMine` acts, cognitive issues it.

- **Who.** One bot per town at a time: the town's `deepmine` lease (`project-<home>.deepmine.slot1`, TTL 8 min, renewed every
  call). `DEEPMINE_SLOTS` = 1 (owner O13; M8 allows 2 later). **Soft preference** (owner C13): the town's last miner may start
  at once; anyone else waits 30 min after its release, then anyone may (flexible jobs).
- **When.** After every town job and the coal run, with nothing else chosen: on the town's surface by its finished stair
  (complete, the y=16 landing built), health >= 16, 8 free slots, 24 blocks to seal and step with, and pickaxe uses for the trip.
  20 min cooldown after a trip, 60 min after one that brought nothing.
- **What trip.** `diamond` when the bag has an iron (or better) pickaxe with 40+ uses AND 120 uses below iron tier for the
  descent (toolfor.mjs already spends the cheapest eligible tool, so stone/deepslate take the stone pickaxes and the iron one is
  kept for the diamond ore); else `iron` with 70 uses in all; else no trip.
- **The trip is a state machine** (the runner cuts every skill at 180 s): `deep_mine` advances one phase step per decision;
  cognitive issues it ahead of the milestone order while the trip is open; admission admits it like `keepout_exit` (the same
  args every call must not hit the repeat window).
  1. **descend** -- the stair's route (every step's stand, then the stub floor) walked **a few stands at a time** (3 per hop,
     1 on a miss) on the town-deposit profile (no digs). A step read `blocked` is **repaired first by the stair's own visit
     code** (`runStairVisit`, holding the builder's slot, after a hop walk to the stand above it): the 852 refused descents
     become a repair and a walk.
  2. **deepen** (diamond trips) -- `mine` to y=-53 from the stub end with the **exit credit** (owner O7): for a leaseholder,
     `canContinueDescent` prices the climb from the stair's y=16 landing, not sea level, because the stair and the trip's own
     trail are walkable. Everyone else keeps today's contract. mine's every other guard is unchanged (lava step, keep-outs,
     the stair's own cells, flood guards). A descent that stalls twice works where it is.
  3. **work** -- the ore in reach first: `gather` of each kind in turn (diamonds below y=0 on a diamond trip, then iron), whose
     tunnel (`tunnelToOre`: planner, break veto beside liquid/falling blocks, lava guard, pickaxe budget) now takes diamond ore
     **on a deep miner's call only**. When no kind is in reach, a **branch**: 12 cells along a bearing, away from the stair first
     and round the compass after. Every cell is **probed before it is opened** (`probeCell`: the cell, its six neighbours, the
     block over a head cell, the floor under a feet cell; lava, water, a falling block, an unloaded cell or a hole ends the
     branch before that cell); a liquid that reaches an opened cell anyway is **sealed** with a block (`sealTargets`, the
     stair's acknowledged placement); a torch every 8 cells when the bag has one. Every stand joins the **trail** (2 apart).
  4. **return** -- when the bag is 2 slots from full, the pickaxes are spent (15 uses; the iron one at 5 on a diamond trip),
     seal blocks < 6, health < 10, 8 diamonds / 24 raw iron, 25 min at depth, 4 empty work rounds, 40 min overall: the trail is
     walked back in reverse to the stub, then the stair up a hop at a time to the collar. A return that makes no progress 3
     times runs today's `surface` once; if that fails too the trip is **abandoned** (`_deepmine end=stranded`), the lease
     released, and the bot is exactly where any deep bot is today (owner O11's residual).
  5. **bank** -- 3 diamonds + 2 sticks -> a **diamond pickaxe** (owner M10) when it has none, then the town deposit (diamonds
     and raw iron are bankable; the deposit's own iron keep for smelting applies).
- **Rows.** `_deepmine op=start|landing|repair|deepen|ore|branch|seal|turn|surfaced|pickaxe|end|error` (`end=home|stranded|
  stair|collar|no_stair|off|error`), `_deepmine_skip why=...` (30 min per reason), `_deepmine_mode` once per spawn.
- **Kill switch.** `DEEPMINE=off` (or `DEEPMINE_POOLS` not naming the pool): no order, no trip, no credit, no diamond tunnel.

What it reuses: the stair geometry and its visit (repair), the build effects (witnessed digs, acknowledged clicks, torches),
`mine` with every guard, `gather` and its tunnel, the exit contract (with a credit, not a bypass), toolfor's iron retention,
`surface`, the town deposit, `craft`. What is new: the lease and the order, the hop walk, the branch planner (probe, seal), the
trail, the return rules.

Refusals and dead ends: the order never refuses anything to the model (no new refusal text); the trip's own stops all lead
somewhere deterministic (repair, the other work kind, a branch, home, surface, abandon to today's chain).

## 4. Not in this slice

- **Water buckets on lava** (section 7) and **obsidian for the enchanting table**: deepminer-02.
- Two miners per town (M8), a dedicated two-lane deep stair (F6), stair credit beyond the leaseholder.
- Prompt lines: none (the job is deterministic).

## 5. Canary

Tier 3: Codex `codex exec` blockers-only AND an independent Claude review, both APPROVE; Paper proof (section 6); fleet canary
queued as a PROGRESS entry after the queued entries; the draw must include towns with finished stairs (11 of 16 pools have
one). Generic read at +90/+180; this change's defect lines: `_deepmine end=stranded`, deaths below y=0 on canary pools,
`_deepmine op=error`, a lease held by two bots. Expect "KEEP, goal unverified" on diamonds unless a trip completes inside the
read: one miner per town, a trip is ~20-40 min, and the first trip needs a bot with an iron pickaxe and 120 stone uses.
After KEEP: the showcase via the reconcile procedure (promoted tree + showcase deltas, parent = live release), with SHAFT on.

## 6. Paper proof

`sandbox/deepmine/deepmine-e2e.mjs` (the whole bot, unmodified, the scripted brain answering `status`): a 161 x 161 arena with
the fleet worlds' layers and lava lake, seeded lava and water pockets at the work depth and down the descent band, diamond and
iron clusters, and a town stair carved from shaftgeom's own plan with a published complete record. Nothing is commanded: the
trip starts by itself. The server's truth afterwards from the saved region files (`regiontruth.py`): `breach` (opened cells
with lava or water beside them) must be 0. Results: `sandbox/log/deepmine-e2e/results.jsonl`, summarised below.

Runs (sandbox2, 11-01/11-02; each a fresh arena; `ok` = home + ore brought back + 0 deaths + 0 breaches + 0 flowing liquid):

| run | code | scene | result |
|---|---|---|---|
| r1-r3 | WIP | diamond | found the gaps the canary would have: the runner's 180 s cut aborted `mine` mid-stair; the maroon lattice pillared the miner out of its own tunnel between calls; gather saw nothing past the sandbox border radius (sandbox artefact); the stone pickaxes ran out and the iron one dug deepslate; the trail back walked the no-dig profile into escape-placed blocks. All fixed. |
| 6 | 61d6ca56 | diamond | **ok**: stair 59 hops (26 s) -> `mine` to -52 (2 calls) -> 2 diamonds -> 3 branches -> home on `stone_pickaxes` via the trail + stair (117 s) -> bank; 0 deaths; truth breach 0, flowing 0, 272 cells dug |
| 7 | 78c26950 | hazard (1,564 liquid sources at the work depth) | **ok**: 1 diamond; the break veto refused a lava-beside diamond 5x, lava_corridor refused a leg; breach 0, flowing 0 |
| 8 | 78c26950 | blocked (dirt in 3 stair air cells, the fleet's failure) | **ok**: `repair step12:blocked->repaired` with the stair's own visit code, then down; 4 ores; home |
| 9 | 78c26950 | iron (stone pickaxes only) | **ok**: iron trip at y=16, 2 raw iron, home |
| final | e5354979 | diamond | **ok**: **8 diamonds**, 1 branch, home, **a diamond pickaxe crafted** at the town table, torches withdrawn from town (12 left) ; 21 min; breach 0 |
| final2 | ec77a45a | iron / blocked / diamond(seed 105) | ok / ok / home with 0 ore (no ore in reach in that seed: `ok` false by the predicate, loop safe) |
| final2 | ec77a45a | hazard (4,612 sources, 3 layers) | **abandoned** at -47 (no death): the walk guard refused every leg back beside lava -> the designed residual (surface once, then abandon) |
| final3 | d26b9382 | hazard | 6 diamonds, then abandoned at -36 after `surface` (no death): lava sealed in rock beside the way back (the walk guard reads buried lava) -> fixed in d59bce0b (the leg seal fills lava within 2 of the leg, buried or not) |
| final5 | d59bce0b | hazard x2 (4,612 sources) | **both home**: seed 102 sealed 11 lava cells on the way back (buried lava filled by a face click: Paper accepts it), 0 ore in reach that seed; seed 106 **ok**: 2 diamonds, 6 seals, home via trail + stair; 0 deaths, breach 0 |
| bucket | probe | lava source beside a branch's next cell, 5 trials | **5/5**: water poured into the open cell turns the lava source to obsidian, the water is scooped back, the bucket returns, cells dry (bucket.mjs pour/scoop on Paper 1.21.8; the probe converts the aims to Vec3: bucket.mjs passes plain {x,y,z} to `lookAt` -- a latent bug for deepminer-02) |

Deaths in all runs: 0. Server-truth breaches (an opened cell with lava or water beside it) in all runs: 0. Flowing liquid left: 0.
The hazard field is ~3x denser than the fleet worlds' work depth (region scan: 1-2.6k lava blocks per 289 chunks at -48..-33);
its abandons are the owner-accepted O11 residual (the bot is alive at depth with its kit; today's exit chain takes over).

## 7. Water buckets on lava (owner 11-01 ~22:40Z) -- deepminer-02

Allowed now. Sequenced as a follow-up, not in the first canary, because it is not low-risk in this slice:
- the bucket action is new mechanics on this fleet (use-item on a face, the server's flow ticks, picking the source back up)
  that no Paper scene here has exercised; flowing water in a 1x2 branch is exactly the drowning shape the survival lane spent
  three canaries on (airpocket, apseal);
- the first canary's probe-and-turn rule already never opens a cell beside lava, so the bucket is an optimisation (fewer
  abandoned branches, obsidian), not a safety need.
Design for deepminer-02: carry one water bucket (filled at the town well / any source at the surface); when a branch's probe
stops on LAVA beside the NEXT cell (not in the bot's own cells) and the lava is a source, pour on the lava cell's face from the
current stand (never into the bot's own column), wait for obsidian/cobble (read back), pick the water source back up
(`bucket.mjs` has the fill/empty plumbing), re-probe; a refusal at any step turns the branch as today. Obsidian blocks found
or made are mined with a diamond pickaxe for the enchanting table (4 obsidian + 2 diamonds + a book; owner M10 after
pickaxes). A tool action, never a reflex: the only water reflex stays getting air.
