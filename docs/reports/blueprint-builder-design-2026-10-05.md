# Blueprint builder + town tree farm — design, build and proof (2026-10-05)

**STATUS (10-06 00:15Z): BUILT, REVIEWED, REGISTERED, NOT LAUNCHED.** Branch `bp-on-1918bb5` @ `453cd07` (base 1918bb5;
the fleet has since moved to 47110e8 — rebase when its turn comes). Codex APPROVE (round 6). Paper sandbox: every
scene passed on the final sha. Registration `docs/reports/treefarm-01.1918bb5.json`; read `scripts/host/treefarmread.py`
(dry run on 10.0.0.31 OK; staged as /tmp/treefarmread.py). Final suite + mutant numbers: §5.
**Queue position (owner 10-05 ~19:00Z): LAST** — after chestfull-02 (live) → withdraw → climbflood → towndeposit →
foodskip → grid fix → bamboo → junk well re-run → cobble rule. Registered, **not launched**; rebased when its turn comes.

**REVIVED 10-15 (see the section "REVIVAL 10-15" at the end): rebased onto fleet 5e663860 (`farm-on-5e66386` @ `b7cc60b5`;
variant `farm-on-8cd0bc6` @ `cc16f64e` for wellsite-03), composed with everything since 1918bb5, **bone meal OFF by
default** (owner, after the Paper A/B), both engines APPROVE, Paper re-run, registered `docs/reports/treefarm-01.b7cc60b5.json`
and `.cc16f64e.json`; queue entry `after: ["wellsite-03"]`. NOT QUEUED.**
The status below is the 10-06 build's.

## For the owner, first

**What it is.** A general "build this structure next to town" skill (the *blueprint builder*), proven first on a
**tree farm**: 9 sapling plots in a 3×3 grid, 4 blocks apart, with 4 growth torches, 9–26 blocks from home. Any bot at
town that holds saplings founds it; after that, bots at town replant it. The fleet's ordinary `gather <log>` harvests it —
the farm never chops a standing tree, so it does not fight the wood gathering, it just puts trees where the bots already are.

**What was borrowed and what was written.** Nothing usable exists to build on: no library verifies a placement against
the server, and the fleet's structures must (a ghost block cost a week in September). So the code is ours, with ideas
taken from:

| source | licence | took | left |
|---|---|---|---|
| Baritone builder (cabaletta/baritone) | LGPL-3.0, Java mod | progress = the re-observed world, never a saved index; place whatever is placeable now; cost penalties that keep paths out of the footprint | the code (wrong language and licence) |
| mineflayer-builder (PrismarineJS) | MIT, "not a usable package yet" (its README), last code 2022 | the support-face choice | its execution: it logs a mismatch and moves on, creative-mode materials |
| Mindcraft construction tasks | MIT | mismatch-explaining output | `placeBlock` returns true 200 ms after the click with no read-back |
| Voyager `placeItem` | MIT, dormant since 2023 | nothing | counts a placement as done if the item count dropped |
| prismarine-schematic | MIT, maintained | later, as a `.schem` importer, if blueprints ever come from files | not needed for hand-written blueprints |
| mineflayer-pathfinder | MIT, the fleet's | `exclusionAreasBreak` / `exclusionAreasPlace` (already used by the junk well) | — |

**What was measured, on Paper, before the size was fixed** (sandbox4, randomTickSpeed 30 = 10×, open sky):

| condition | grew | median | slowest | logs per tree |
|---|---|---|---|---|
| oak, 4 apart, noon | 16/16 | 99 s | 289 s | 4–7 (one fancy oak: 23) |
| birch, 4 apart, noon | 16/16 | 99 s | 182 s | 5–7 (mean 6.3) |
| oak / birch, 3 apart, noon | 9/9, 9/9 | 40 s / 74 s | 234 s / 154 s | (overlapping canopies) |
| frozen midnight, no light | **0/9, 0/9** | — | — | — |
| frozen midnight, the farm's own torch layout | **16/16, 16/16** | 99 s / 120 s | 296 s / 203 s | 4–13 / 5–7 |

At the fleet's randomTickSpeed 3 that is a **median ~16 minutes per sapling in light**, and without torches nothing
grows at night. So a 3×3 farm is not limited by growth (≈ 50 logs per full cycle, a cycle well under an hour with
torches); it is limited by how often bots harvest it. **Demand** (coordinator, 24 h, 80 bots): ~1,300 logs/day for
crafting and fuel (~81 per town) and ~5,500/day with scaffold (~344 per town); 3×3 with torches covers the second
without a 4×4. Growth also needs a **ticking chunk**: random ticks only fire within simulation distance (6 chunks) of a
player. Next to town that is most of the time (59.8% of canary bot rows were within 96 blocks of home in the dry run);
the read reports it.

**Materials are already in the bags** (fleet census 10-05 19:30Z, latest snapshot per bot in the last hour, 52,356
rows / 80 bots): **76 of 80 bots hold ≥ 6 birch+oak saplings** (enough to found a farm), **62 of 80 carry torches**,
930 bone meal fleet-wide. So the farm needs no withdraw to be built and lit; bank torches (2,050) become reachable when
the withdraw canary lands.

**Switches.** `TREEFARM_ENABLED` (default on; a kill switch). `TREEFARM_BONEMEAL` (**default OFF**: bone meal on
saplings is not an owner decision yet; the arm is built and Paper-tested separately, at most 6 per visit).

**What it measures** (`scripts/host/treefarmread.py`): logs gathered per bot-hour, the same within 48 of home, median
distance from home of a successful log gather (rose 66 → 80 in four days), gather seconds per log (the over-gathering
cost), each a DiD against randomized control pools; deterministic gates (REVERT): an off-plan placement, two bots
building one farm at once, an item lost during a visit, a town founding two farms.

**Follow-ons, designed not built:** the town WORKSHOP and the SAFE MINESHAFT (section 7), with their risks.

## 1. The two designs and the synthesis

Claude and Codex designed independently (Codex: `--search`, read the repo and the junk well branch). Where they
disagreed, an executed run decided (CLAUDE.md "a run beats a reading"):

| question | Claude | Codex | decided by |
|---|---|---|---|
| layout | 3×3, 4 apart, near town | 6 birch, 7–8 apart, 24–32 from home | **Paper**: 3 and 4 apart both grow 100%; 4 keeps a 3-wide walkway and every neighbour's leaves (radius 2) out of a column. 9–26 from home keeps the farm inside a town bot's `gather` search (32). |
| torches | optional | one per tree, required | **Paper**: no light, no growth at night (0/18); the 2×2-centre layout (manhattan 5 → light 9) grew 32/32 at night. Torches are placed when carried; withdrawing the bank's 2,050 torches waits for the withdraw canary. |
| who harvests | the ordinary gather | a per-tree harvest claim inside the farm visit | Claude's: one fewer chopping implementation; the farm clears only LEFTOVER logs a partial harvest strands in a column (the measured failure mode of a floating trunk: a column that is not clear never grows a sapling again). |
| server truth | blockUpdate after placeBlock | a server-only block ledger | both: mineflayer 4.37.1's `placeBlock` does not predict (it waits for the server), but its DIG writes air before the server answers. The builder listens to the raw `block_change`/`multi_block_change` packets for both (`installBlockWitness`). |
| ownership | lease + idempotent cells | lease with fencing + a host coordinator | a lease whose generation is a fencing token, checked before every mutation. Overlap is HARMLESS for this blueprint (a second placement into an occupied cell is refused by the server); a host coordinator is deferred to the mineshaft, where a stale dig is not harmless. |
| sapling supply | the bag (4,362 held fleet-wide) | bounded bank deposits of saplings | the bag; saplings stay NEVER_BANKABLE. |

## 2. The blueprint builder (bots/src/blueprint.mjs)

Generic, pure where it can be, and small. What a later blueprint (workshop, mineshaft) reuses as is:

- **A frozen record per town.** The blueprint is fitted to the terrain ONCE, at acceptance, and the record stores the
  resolved absolute cells (`{ blueprint, version, anchor, cells: [{x,y,z,role}], world }`). Every bot and the canary read
  agree on what "the structure" is; terrain changing later cannot move it. Written as generation files
  (`<key>.g<N>.json`, created with `link()`: one writer wins each N). Record generations are **never pruned** (Codex r1:
  pruning lets a slow writer re-create an old number). A record from another world (reseed) counts as absent.
- **Progress is the world** (Baritone's rule). A visit reads every cell (`cellStatus`: done / open / blocked / unknown)
  and does what is placeable now; there is no saved index to disagree with the structure, so an abort, a disconnect, a
  restart or a different bot all resume from the same truth.
- **One builder at a time: the lease.** Generation files too (`<key>.lease<N>.json`), 90 s, renewed before a mutation
  when < 45 s remain, released in a `finally`. The generation is a **fencing token**: before EVERY mutation the builder
  re-checks it still holds the current lease generation AND that the farm record is still the generation it read; if
  not, it stops (`stop=lease_lost` / `stop=farm_record_replaced`). The record is only ever (re)written under the lease
  (Codex r1). A taker verifies after `link()` that its generation is the current one (lease files are pruned, so a
  pruned number could be re-created). A torn (unreadable) lease is treated as held. For this blueprint overlap is
  harmless anyway — every mutation is "put X into this designated empty cell", which the server refuses twice — so the
  lease buys efficiency; the mineshaft (digging) needs it as a real mutex.
- **Server truth for every mutation** (`installBlockWitness`). The raw `block_change` and `multi_block_change` packets
  are read beside mineflayer's handlers; a placement or dig counts only when a server packet names the wanted block at
  that cell (`witnessVerdict`: the last word wins, so a correction after a confirmation is a refusal; nothing said is
  `silent`, never success). This covers both ghost directions: mineflayer 4.37.1 `placeBlock` does not predict, but its
  dig writes air locally before the server answers (`digging.js:158`). The multi-block decoding matches mineflayer's own
  bit for bit (tested).
- **Where to stand, what to click.** `standsFor` (feet and head passable over a solid floor, never the target unless
  digging up its own column, never a reserved cell, never another body, within reach; deterministic order),
  `refFaceFor` (the block below first; never a container or station — clicking those opens them), `wouldEnclose` (a
  solid placement that leaves the bot no cardinal exit is refused — for the workshop/mineshaft; saplings and torches
  cannot enclose). Reach: 4.5 to the block centre to place; 5.0 to dig (Paper accepts 4.5 + 1.0 to the block's nearest
  point), so a log six above a plot is reachable from the plot cell and seven is not.
- **Materials** (`materialPlan`): what the remaining cells need against the bag; alternatives (any farm sapling) draw
  from the most-held. Shortfalls are named for the refusal.

## 3. The tree farm (bots/src/treefarm.mjs, skills.mjs `tend_farm`)

- **Layout.** 3×3 plots, trunks 4 apart (a 3-wide walkway), torches at the four 2×2 centres (manhattan 5 to each
  sapling's top → light 9, measured to grow at midnight). Anchors on rings 9–22 around home; every plot ≥ 6 from home
  (bots idle there) and ≤ 30 (town distance) so a bot gathering from town reaches it (gather searches 32).
- **A plot** is plantable soil (dirt, grass, podzol, coarse/rooted dirt, moss, mud) under a replaceable cell with **7
  air cells above** (birch needs 6, oak 5 — measured; one of margin), no liquid within 1, no container, station or the
  composter within 3, not another structure's cell, not unknown. The farm is accepted with ≥ 6 usable plots; plots
  follow gentle terrain (±2 of the anchor; no levelling). The search is deterministic (every bot computes the same farm),
  memoised, takes the best of the first 24 fits, and any unloaded cell means "no farm yet" (never a private answer).
- **Plot states** (`plotState`): tree · sapling · ready (leaves in the column allowed: measured, 16/16 grew under six
  leaf blocks) · soil_lost · logs_above (a partial harvest's floating trunk) · soil/cell/column_foreign (quarantined,
  never demolished) · unknown.
- **The visit** (`tendPlan`, in order): dirt back where soil was dug; leftover logs out of plot columns, lowest first,
  only up to 6 above the plot (higher is out of dig reach: counted `logs_high`, never an action that fails forever);
  saplings it HOLDS (birch first while it lasts, then oak); torches it carries; bone meal (arm on only, ≤ 6). At most 14
  mutations, 75 s. Every action re-reads its cell just before acting (a log that became a chest while the bot walked is
  not dug — Codex r1), walks to a stand, holds the item, fences, clicks, and waits for the server.
- **Founding.** No record yet: a bot at town with ≥ 6 farm saplings gets the order; the site search runs inside the skill
  under the lease, never on the decision path. A recorded farm that is no longer a farm (fewer than 6 usable plots)
  schedules its own replacement the same way (Codex r1).
- **The order** (`farmOrder`): only at town (≤ 48 of home), only when this bot's view of the farm has work it can do,
  a 5-minute cooldown charged when issued, world scans at most every 30 s, a 20-minute backoff after a failed visit; a
  skip, an interruption, a runner refusal or a held lease cost nothing more. Never the model's choice
  (`HOUSEKEEPING`, `chatOnly`). Evaluated after the composter and before the planting obligation.
- **Refusal chain** (CLAUDE.md: a refusal must name a remedy the bot can perform from where it is): no saplings → the
  order is never issued (so no loop); a visit with ready plots and no saplings says "chop any tree (gather birch_log or
  oak_log) — its leaves drop saplings", which a bot at town can do, and the farm's own trees are the nearest; another
  bot's lease → "nothing for this bot to do there now" (a free skip); an unloaded plot → "the farm waits for a closer
  visit". Tested as a chain (`REFUSAL CHAIN` in treefarm.test.mjs).

## 4. Every other bot keeps off it

| path | guard |
|---|---|
| every pathfinder profile (walk, gather, collectblock's, ascend, descend, water, tunnel, composter walk) | `exclusionAreasBreak` = farm soil and torch floors (cost 100: never dug); `exclusionAreasPlace` = plot columns and torch cells (never scaffolded into). Installed on the base profile BEFORE the clones share the arrays (the water profile replaces only the STEP array; the tunnel spreads these into its own). Walking through the farm and harvesting its logs stay open. Index from the record on a 20 s cache; refreshed when a visit founds the farm. |
| `gather` (dirt / grass targets) | farm soil cells filtered out of the targets at all three `findBlocks` sites |
| `place` | a scan skips reserved cells; explicit coordinates on one are refused with the remedy (`place X` without coordinates picks another cell); the station make-room dig never digs a plot column (Codex r1) |
| `roomVeto` (place's make-room, `wear_out`) | farm soil is `town_structure` |
| the planting obligation | never plants in the farm's walkways (box + 2); a farm plot is fine |
| the composter's site search | sees farm cells as occupied (`reservationAwareRead`) |
| `build` (model) | refuses farm cells |
| **on rebase (not on 1918bb5)** | chest-full's `chestSiteRefusal` and the junk well's site search must refuse `farmIndex` cells, as the chest fix had to refuse `wellReservedCells` |

## 5. Tests, mutants, Paper sandbox

**FINAL, on 453cd07 (under /tmp/mcai-suite.lock): `node scripts/run-tests.mjs` 225/225 files; treefarm.test.mjs
57/57; anchored mutants 23/24 killed (`sandbox/treefarm/mutants.py`); eslint clean but for the pre-existing `withinBody`.**

**Unit / behaviour** (`bots/test/treefarm.test.mjs`, 57 tests): every pure decision through its export; the real
`tend_farm` against a fake world whose SERVER is separate from the client (placements and digs confirmed only by
`block_change` packets; the fake can stay silent, refuse, or leave a client-only ghost — none of which is counted);
one-builder (a second bot finds the lease held), a lease stolen mid-visit, a record replaced mid-visit, an abort that
resumes from the world, leftover logs (a ghost dig is not a clear), soil restored, the refusal chain, a contender that
must not rewrite the holder's record, a log replaced by a chest during the walk and during the equip, a rejected equip,
no-site backoff, make-room never digging a plot column, and the wiring (exclusions before the clones; skill registered,
housekeeping, cognitive). Full suite `node scripts/run-tests.mjs`: 224/225 on the first full run — the one failure was
the new fitFarm test's own fixture (an anchor whose plots were past FARM_MAX_DIST), fixed; treefarm.test.mjs 56/56
after the next change. eslint: clean on the changed files (the tree-wide `withinBody` error in reflex.mjs is
pre-existing).

**Anchored mutants** (`bp-mutants.py`: every anchor asserted present and unique, applied to a copy, the test file must
fail): **23 of 24 killed, each by the test named for it.** Three first survived (no reach cap on leftover digs, no
order cooldown, an unknown plot column inside a fit) and got tests; one mutant was itself broken (a syntax error read
as "killed") and was rewritten. The survivor is the structural off-plan guard in the visit loop, which is equivalent
by construction (the plan only ever emits recorded cells; `onFarmPlan` is tested directly) — kept as a belt-and-braces
guard and named here rather than counted.

**Paper sandbox** (sandbox4, `sandbox/treefarm/treefarm-e2e.cjs`, the real bot from the branch, RCON is the oracle,
arena inside the bot's world border; growth experiments `sandbox/treefarm/tf-growth.cjs`). Re-run on the final sha
453cd07: build, resume and lease identical to the table below (9/9 + 4/4, 0 off-plan, bag exact, nothing dropped):

| scene | what happened (server truth) |
|---|---|
| build | founded the canonical farm (record = the harness's own computation); **9/9 plots planted (6 birch, 3 oak), 4/4 torches**, every one confirmed by a server packet; bag delta exactly −6 birch −3 oak −4 torch; bone meal untouched (arm off); **0 off-plan cells, 0 soil holes, 0 items on the ground** |
| resume | SIGKILL (disconnect) after the 3rd confirmed planting; restart (same name, lease still its own): **the rest planted, 9/9 + 4/4, same record generation**, bag conserved, nothing dropped |
| lease | another bot's live lease on disk: **no record written, 0 placements** ("another bot (sandbox-Other) is tending"); after expiry (and its own 5-min cooldown) it built 9/9 + 4/4 |
| paths | the real bot inside the farm: `gather dirt` (took 6 grass/dirt blocks right next to the farm), `place crafting_table` (scan), `goto` across the farm and back: **all 9 plot soils, 9 saplings, 4 torches and 4 torch floors intact**; the table and the dirt holes landed in walkways (not reserved, by design) |
| grow (run 2) | 6 trees at rtick 30; the ordinary `gather birch_log` took 11 logs and left 2 floating in a plot column; **the next visit cleared both (server-confirmed)** — the designed loop. It then found a defect: a clearing-only visit was scored `unknown` (world_change counted placements only), which the order backs off 20 min, so no replant came in the window. Fixed (55e6a53: every confirmed change counts); re-run below. |
| grow (run 3) | gathers 11 birch + 10 oak; the visit cleared 3 leftover logs — and then **no replant came: plots stayed `leaves_above`**. A harvested tree's leaves stay alive while a NEIGHBOUR's trunk is within 6 blocks, and 4 apart it always is, so "wait for the leaves to decay" never replants a standing farm. Experiment (sandbox4, rtick 30, a torch beside every sapling so light is not the variable): **a sapling under six leaf blocks grew 16/16** (oak median 71 s, birch 56 s) against the open control's 16/16 (49 s / 86 s). Fixed (5273252): leaves in a column are not an obstruction. |
| grow (run 4) | **the loop closes**: 6 trees → the ordinary `gather birch_log` (10) and `gather oak_log` (10) → visit 1 cleared 1 leftover log and replanted 1 → visit 2 (5 min later) replanted 3 under leaves → **6 trees + 3 saplings, every plot occupied, reserved cells intact**. The gathers' own scaffold left 6 andesite blocks in the walkways (allowed: not reserved; see risks). |
| harvest A/B | the SAME farm (canonical layout, planted by RCON, grown at rtick 30), gathered by the baseline bot (1918bb5, no farm code) vs this build (farm record on disk, exclusions active), ctrl/cand/cand/ctrl: logs gathered **ctrl 15, 16 vs cand 21, 23**; leftover logs in emptied columns ctrl 3, 4 vs cand 1, 7 (the 7 before its visit cleared 2); `gather oak_log` finished 0/2 on control ("found but unreachable", 7.7% of the fleet's log gathers end that way) vs 2/2 on the candidate. n = 2 per arm: **no sign the exclusions hurt the harvest**; not a claim that they help. |
| bonemeal (arm ON) | first visit planted 8 (the bag held 9; the planting obligation, which fires above 8 held, took one before the farm existed); second visit bone-mealed 6 saplings, **6 consumed per the server's bag**, none grown yet (45% per stage, two stages) |

**Independent Codex review, six rounds, APPROVE at 453cd07.** r1 (5 P2): make-room could dig a plot column for a
station; a leftover-log dig could hit a block that replaced the log mid-walk; pruning record generations broke the CAS
(and a created record could be returned with another writer's generation); a bot refused the lease could still replace
the record under the holder; a dead farm could never schedule its own replacement. r2 (2 P2 + test gaps): a failed
hand swap could let a protected pickaxe dig a log; a pathfinder scaffold could fill a MISSING soil cell. r3 APPROVE.
r4 (after the Paper fixes): the world border must apply to a recorded farm too. r5: an accepted record straddling the
border must not plan its outside cells. r6 APPROVE. Every finding has a regression test.

## 6. The read and the registration

`scripts/host/treefarmread.py` (modelled on composterread: rotation-aware `load_window`, rows sorted by time,
restart-lag rows on another build excluded, parser self-tests, homes from `/srv/mcbots/harness/env/*.env` HOME lines only).

- **Liveness**: canary `_farm_*` rows on the canary build ≥ 1; control 0.
- **Deterministic gates (REVERT, evidence: defect)**: C1 off-plan — a confirmed `_farm_place` at a cell outside every
  generation of its town's record on disk (`/var/lib/mcai/_pool-<pool>/treefarm-<home>.g<N>.json`), or any visit with
  `offplan > 0`; C2 two builders — mutating visits by different bots of one pool whose spans `[t0, t]` overlap; C3 an
  item lost during a visit; C4 two farms founded in one town; and **bone meal used > 0** (the arm is off).
- **Positive control**: control log gathers with logs > 0 (352 in the 3 h dry run, 10-05 15:24Z); exposure = ≥ 9
  confirmed canary plantings and the control instrument.
- **Primary (reported, not gated)**: logs gathered per bot-hour DiD, the same within 48 of home, the median distance from
  home of a successful log gather, gather seconds per log; plus plantings, cleared leftovers, torches, trees seen per
  visit, and the share of canary rows within 96 of home (ticking exposure). **The null is wide**: the dry run with
  chestfull-02's pools as "canary" (no wood change) read logs/bot-h DiD +1.90 and gather-distance DiD +35 blocks; a
  verdict must not rest on these, which is why they are reported and the gates are the deterministic ones.
- **Registration** `docs/reports/treefarm-01.1918bb5.json`: licence kind `_farm_tend` (min 1), change_rows
  `farm_tend`, `farm_place` (new rows the baseline cannot emit), reads `treefarmread` + `immobiledid`, reads at +180/+360,
  extensions 540/720, deadline 780, the two-death floor unchanged. **Not launched.** It chains last; the sha is rebased
  onto whatever the fleet runs by then and re-registered.

## 7. Follow-on blueprints (designed, not built)

Both reuse §2 unchanged (record, lease + fence, witness, stands, ref faces, enclosure check, material plan) and add the
pieces below. Neither is built; each would be its own canary after the farm reads.

### 7a. Town WORKSHOP — a fixed crafting table, furnaces and bank chests

- **Blueprint** (relative to an anchor on flat ground near home, rotation chosen at fit time): a 7×5 pad; crafting table
  (1,1,1); furnaces (3,1,1) and (4,1,1); three single chests (1,1,3), (3,1,3), (5,1,3) — never adjacent, so no double
  chest forms by accident; every lid cell above kept air; a 1-wide service aisle in front of each station reserved.
  Facing is a block property: the blueprint carries it and the placement looks from the side that yields it (the
  mineflayer-builder face/facing idea); the read-back compares state, not only name.
- **Materials**: planks for the table, 8 cobblestone per furnace (the fleet banks ~7,200 cobble/day — the workshop is the
  first real sink), 8 planks per chest. Plan from bag + town chests — **needs the withdraw canary first**; until then a
  short bag is "gather/deposit X", never a trip that cannot finish.
- **New pieces**: block-state matching (facing), sneak-to-place against interactive blocks (mineflayer issue #108: the
  caller must sneak), and adopting the workshop's stations in craft/smelt/bank so they are USED (register the fixed table
  as the town table; chest-full's new-chest placement must refuse the workshop footprint).
- **Risks**: building over a path or an aisle other code uses (the reservations in §4 must cover it); a chest-full
  recovery chest landing beside a workshop chest (double chest); fuel/input ownership of shared furnaces (two bots'
  smelts interleaving); a crafting table placed by the craft skill a few blocks away making the fixed one pointless.

### 7b. SAFE MINESHAFT — to iron depth, walls that never open water or lava

- **Blueprint**: a 2-cell core per level, (0,y,0) and (1,y,0), cobble-lined perimeter x=-1..2, z=-1..1; a ladder at
  (0,y,0) on the z=-1 wall; a landing every 8 levels; default target y=16 (iron's common band). Built ONE LEVEL AT A TIME
  from supported footing: survey → dig → line → ladder → verify → descend.
- **The safety rule is in the survey, not the lining**: before removing a core cell, read all of its six neighbours and
  every lining cell's outer neighbours (`unknown`, liquid, waterlogged, a falling block or a cavity stops extension);
  lining replaces any non-solid neighbour BEFORE the core cell is opened. A stop leaves a sealed end and a ladder up.
  This is the underground-safety finding (every drowning was a sealed pocket; the escape climb dug into water unchecked)
  turned into a construction rule.
- **New pieces**: witnessed digs as a first-class mutation with the same fence; a real mutex (a stale builder's late dig
  is not harmless here: the lease must be checked AND a host-local lock held across each dig, Codex's coordinator);
  continuous exit verification (the ladder column to the surface re-read each level); interaction with the ore tunnel
  (the shaft is the tunnel's entry, not a second miner).
- **Risks**: a ghost dig (client air over server stone) mid-shaft — every dig witnessed, a silent one stops the level;
  gravel/sand above an opened cell; lava below a level that read as stone from above (survey one level ahead); bots
  without enough cobble mid-shaft (reserve the next full level's lining before starting it); other bots' paths using the
  shaft as a drop (step exclusion on the core column except for the builder).

## 8. Risks and what would catch them

| # | how it could fail in production | what catches it |
|---|---|---|
| 1 | **The farm is inert**: bots rarely at town with ≥ 6 saplings, or the farm's chunk is not ticking | the read's liveness (canary `_farm_*` rows), exposure (≥ 9 confirmed plantings), the farm census (trees seen per visit) and the share of canary rows within 96 of home |
| 2 | **Ghost success**: a placement or dig counted that the server never made | every count needs a server packet at that cell (unit: silent / refused / client-only ghost all count 0; Paper: RCON per plot) |
| 3 | **Two builders / a replaced farm mid-visit** | the lease + record-generation fence (unit: a stolen lease and a replaced record each stop the visit before its next mutation); the read's C2 (overlapping mutating visits) |
| 4 | **Other code damages it** (a gather digs its soil, a scaffold or table lands in a column, the planting obligation crowds it) | every profile's break/place exclusions + the gather/place/roomVeto/planting/composter guards (unit + Paper `paths`); the read's C1 for our own placements; the visit's census reports lost soil and foreign blocks |
| 5 | **The harvest strands the farm**: the ordinary gather takes the bottom of a trunk, leaving logs that block the column for good; or the dead tree's leaves (kept alive by the neighbours) block it | the farm clears leftover column logs up to 6 above; leaves do not block (measured); Paper `grow` run 4 closes the loop; higher leftovers are counted `logs_high` |
| 8 | **Walkway clutter**: the gathers' own pillars (6 andesite blocks after one harvest on Paper) accumulate between the plots | not a growth problem (only columns are reserved); visible in the visit census over time. If it grows, the follow-up is a walkway sweep in the farm visit or a place exclusion over the whole box — the latter would also stop gather pillaring up to a farm tree's top logs, so it needs its own A/B |
| 6 | **A refusal with no executable remedy** | the order is only issued when this bot's view has work it can do; the skips name a gather (no saplings), a wait (unknown, leased) or a long backoff (no site). Chain tested. |
| 7 | **Composition with the queue ahead** (withdraw, towndeposit, junk well, chest-full) | rebase requirement: chest-full's `chestSiteRefusal` and the junk well's site search must refuse `farmIndex` cells; re-run treefarm.test.mjs and the Paper `build`/`paths` scenes on the rebased sha |

## REVIVAL 10-15: treefarm-01 on the current fleet (5e663860); bone meal OFF by default

**STATUS (10-15 05:10Z): REBUILT, REVIEWED, SANDBOX-PROVEN, REGISTERED, NOT QUEUED.** The owner asked about the farm on
10-15 and wants it running. Bone meal: the owner first chose ON; after the Paper A/B below (first trees sooner, no log gain
measured, 43 bone meal per farm-hour) the owner decided "do it the way you recommend": **OFF by default**, the bounded arm
kept behind `TREEFARM_BONEMEAL=on` (an arm-on pool would need its own registration without the `bonemeal_used <= 0` line).

| | |
|---|---|
| branch, fleet 5e663860 | `farm-on-5e66386` @ `b7cc60b5` (registration `docs/reports/treefarm-01.b7cc60b5.json`) |
| branch, if wellsite-03 is kept (8cd0bc62) | `farm-on-8cd0bc6` @ `cc16f64e` (registration `docs/reports/treefarm-01.cc16f64e.json`); the same net diff, one union hunk in townWellSite |
| read | `scripts/host/treefarmread.py` (md5 `600bc66715bf8b8dfe08b299507c2a5e`; installed on 10.0.0.31 as ~/mcai-analysis/treefarmread.py, the 10-06 one kept as `.bak-20261015-1918bb5`) |
| queue entry | `docs/reports/treefarm-01.queue-entry.json`, `after: ["wellsite-03"]` (for the operator; NOT queued). The airpocket-03 variant was dropped (airpocket-03 closed INCONCLUSIVE). |
| reviews | `docs/reports/treefarm-01-revival-reviews-2026-10-15.txt` |

### What changed in the rebase

The approved 453cd07 diff applied to 5e663860 as one commit; every conflict was a union (cognitive.mjs order placement,
HOUSEKEEPING, the index.mjs exclusion arrays, the skill contracts/registrations; `sameWorld` from composter.mjs). Then:

**Composition, each tested from both sides (bots/test/treefarm-compose.test.mjs, 20 tests, five through the REAL CognitiveLoop):**
- **Junk well.** A well cap and a farm plot keep 4 apart (a torch 2). A NEW well site keeps off the farm (`wellSearchAvoid`;
  the plinth planner uses the same list); a RECORDED well site is judged without the farm, so a farm can never move a well.
  The farm yields instead: `farmYields` refuses a farm record inside the keep-out of a well, a plinth plan or a live chest
  claim, and the town re-founds from the same list (stable). A race between the two foundings resolves one way, always.
  A farm visit never picks a stand in a well's column. A structure recorded mid-visit stops the visit at the fence (the
  last step before every click).
- **Raised well (plinth-01, not in this base).** The farm reads its plan record when present and keeps off the cap and every
  planned cell/stand. Test merge `farm-x-plinth`: `plinthKeepOut` carries `farmKeepOut`; the planner test proves a plan is
  still found and never touches a farm cell. **Whichever of the two lands second carries that one-line patch.**
- **Chest-full.** A new chest never goes in a farm cell or within 3 of a plot; a farm refusal widens the search exactly as the
  well's (`widensChestSearch`, a pure export). The farm avoids chests in flight (live claims) at founding and yields to a
  claim only by chest-full's own rule, so a legal chest never moves it.
- **Town floor (townfloor-01, READY on main).** The farm never sites a plot or torch cell in the floor's band. Test merge
  `farm-x-floor`: `floorKeepOut` carries `farmKeepOut` (a dug-out farm soil cell AT L is otherwise a floor target);
  both orders keep their own cooldowns (floor, then farm). **Whichever lands second carries that patch.**
- **Town zone (townzone-01).** Logs are not terrain, so the zone and the farm's own digs never meet; gather's two dirt
  filters compose (test merge `farm-x-tz`: the zone's remedy still finds dirt beyond the farm).
- **_dig_town.** The farm's leftover-log dig is a `target` dig by `tend_farm` (class free).
- **Walks.** The order is issued only within 12 of home's level. Blocks this bot's own walk placed (bot.placeBlock while
  holding a scaffold block, confirmed by the server at that cell) are `scaffold=`, never `lost=` (found on Paper: a bot under
  the farm towered up and would have tripped C3). Known edge: a confirmation later than ~6 s reads lost=1.
- **Stock targets / composting / prune.** Saplings are PROTECTED (never pruned or disposed); composting keeps 16 of each
  farm species; the farm needs 6 to found. Tested through the real loop (a full bag at town: the orders ranked ahead keep
  their turn and the farm order still comes).
- **Town projects (designed).** Their siting already keeps off "tree-farm cells and walkways" and any tree within 3. When the
  shared `townsites` file exists, `farmAvoid` must read it (stage 3, yard-01, adds it).

**Bone meal (owner 10-15).** OFF unless `TREEFARM_BONEMEAL=on` (the registration gates `bonemeal_used <= 0`). The arm's bounds: only a sapling whose column is clear (vanilla eats
bone meal even when the tree cannot fit); never below 8 in the bag; at most 6 a visit; leftover logs above a sapling are
cleared first. Rows: `bonemeal` (confirmed by the bag), `bm_grew` (a log named by the server at the cell right after),
`bm_spent` (the bag's loss over the visit).

### What it costs and gains (measured 10-15)

| | |
|---|---|
| fleet bags (ES, latest per bot, 10-15) | **1,984 bone meal**, median 19 a bot; 68 of 80 bots hold more than the reserve of 8; **1,403 spendable** above it |
| fleet production (composting) | **90 in 24 h / 204 in 72 h** = 0.035-0.047 per bot-hour (~70-90 a day fleet-wide) |
| what the farm can spend | at most 6 a visit, one visit per bot per 5 min, only on a clear sapling, never below 8 in the bag |
| Paper A/B, same farm, rtick 3, 60 min, run 1 (01:07Z) | OFF: 90 logs, plant->tree median 812 s, first tree 3 min. ON: 57 logs (the bot fell off the floating arena at ~27 min: confounded), median 481 s, 18 bone meal |
| Paper A/B, run 2 (02:10Z, bot kept on the arena) | OFF: **114 logs/h**, median 906 s, first tree 8 min, 0 bone meal. ON: **93 logs/h**, median 815 s, first tree **2.5 min**, **43 bone meal** (7 of 61 uses over both runs grew a tree within 600 ms) |

**Gain:** the first trees come sooner (2.5-6 min against 3-8 min) and plant-to-tree is shorter (median 481/815 s
against 812/906 s). **No log gain was measured:** logs per hour were not higher with bone meal in either run (n = 2 per
arm, noisy) -- the harvest (the ordinary gather's cadence), not growth, limits a 3x3 farm with growth torches.
**Cost:** one farm tended continuously spent **43 bone meal an hour** on Paper -- about half the whole fleet's DAILY
composting output. In production the bags' 1,403 spendable bone meal would drain in days and then spending is capped by
composting (~5 a town a day); the reserve of 8 per bot stays. Nothing else in the code consumes bone meal (the well and stock
targets protect it), so nothing is starved; the cost is the stock itself. The read reports bone meal per canary bot-hour
and the share that grew a tree. If the owner wants the stock kept, `TREEFARM_BONEMEAL=off` (per pool env) or a lower
per-visit cap are one-line changes.

### Paper sandbox on the rebased build

Real bot from the branch, loopback brain, RCON as the oracle (`sandbox/treefarm/treefarm-e2e.cjs`; sandbox lock held as
`treefarm` 01:06-03:20Z; sandbox2/3/4; arena only; randomTickSpeed restored to 3 on every server).

| scene (38e74f69; the final src differs only by the bone-meal default flip) | server truth |
|---|---|
| build | 9/9 plots + 4/4 torches confirmed, record = the harness's canonical layout, 0 off-plan cells, bag exact, 0 items on the ground; bone meal 5 in the bag (under the reserve): 0 spent |
| resume | SIGKILL after the 3rd planting; restart completes 9/9 + 4/4, same record generation, 0 dropped |
| lease | another bot's live lease: no record, 0 placements; after expiry it built 9/9 + 4/4 |
| well | a recorded junk-well site and a plinth plan on the canonical farm's plots: the farm founded elsewhere -- nearest plot 17.0 from the well, 9.1 from the plinth cap, 6.1 from a planned plinth cell; 9/9 + 4/4 |
| stock | a full bag (35 slots, 40+40 saplings, leaf litter) at town with a composter and a chest: the farm founded 9/9 + 4/4 AND the compost order ran (71 items in); composting stopped at 16 of each sapling (its reserve) |
| paths | gather dirt, place a crafting table, goto across: all 9 soils, saplings and 4 torches intact (the table and two holes landed in walkways, unreserved by design) |
| grow (on e8104d51) | 6 trees -> the ordinary `gather birch_log` (10) -> the visit cleared 3 leftover logs -> replanted 2 ready plots |
| zone (townzone merge) | gather 12 dirt beside the farm with the zone on: 12,144 town-ground candidates skipped, all farm cells intact |

### Tests and mutants

- `npm test` (node scripts/run-tests.mjs): **252/252** on b7cc60b5; **253/253** on the wellsite-03 variant cc16f64e.
- `treefarm.test.mjs` 63 tests (the reviewed 57 + bone meal off by default, bone meal bounds, the arm on and a lagging bag, walk
  scaffold vs toss, the order's level); `treefarm-compose.test.mjs` 25 (each keep-out from both sides, races, mid-walk /
  mid-look / mid-visit yields, chest-full's widening, the floor band, digtown, a stand in a well column, five chains through
  the REAL CognitiveLoop).
- Test merges (each green on its own tests + the farm's): farm-x-tz (+ `treefarm-zone.test.mjs`: the zone's remedy still
  finds dirt past the farm), farm-x-ws (wellsite), farm-x-pl (+ `treefarm-plinth.test.mjs`: the planner never touches a
  farm cell and still finds a plan), farm-x-floor (+ `treefarm-floor.test.mjs`: a dug farm soil cell at the floor level is
  not a floor target).
- Anchored mutants (`sandbox/treefarm/mutants.py`, every anchor asserted present and unique): **52 of 56 killed**. Named
  survivors: the structural off-plan guard (plan cells are on-plan by construction); the bone-meal column re-read (the plan
  already excludes a blocked column); chest-full's farm-cell check (every farm cell is also within 3 of a plot, so the
  distance rule refuses it); the farm avoiding a FOUND well (the fakes build no well; the recorded-site path is killed).
