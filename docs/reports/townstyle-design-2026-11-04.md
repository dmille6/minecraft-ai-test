# townstyle-01: pitched roofs and charm for the town's buildings (design, 2026-11-04)

**Owner, 2026-11-04:** "my question is about asthetics. can we put some design charm into the buildings and not have flat
roofs, lets make them have angled roofs etc, to make it look more like a town not just blocks with doors".

**What is done:**

- **Proof.** The bots can place every oriented block a roof needs, in every state. A Paper sandbox run placed each one
  and the server's own state check confirmed it.
- **Built.** A shared style library and a first building with a pitched roof (the cottage) are built and tested, and a
  real bot on Paper built the cottage end to end.
- **Pictures:** [`townstyle-2026-11-04/townstyle-sheet.png`](townstyle-2026-11-04/townstyle-sheet.png) (before and
  after), and one PNG per design beside it. ASCII elevations are in
  [`cottage-elevations.txt`](townstyle-2026-11-04/cottage-elevations.txt).

Code: branch `townstyle-01show` on the live showcase release 8b4ea9cc. The tripwire rule RO1 is in
`docs/reports/shop-01-2026-10-25/shopread.py.txt` on main, **not installed**.

## 1. Measured

**Every building is a flat box.** The blueprints are `bots/src/blueprints/*.json`: house@1 7x7, workshop@1 9x7, hall@1
15x13, storehub@1 19x11, enchantshop@1 17x11, and the yards. All of them are:

- a pad at y 0;
- walls 2 high (y 1-2);
- a flat roof at y 3, built as two segments, `roof-edge` and `roof-inner`.

Cells carry a role and a block name, and no block state. buildrun's `cellDone` compares names only. The tripwire's G1/G2
judge cells, not states.

**Why the roofs are flat.** It is reach geometry, not the blueprints. The siting proof (`buildsite.mjs stepFor`) only
allows a click on a face that is on the eye's side and in its sight.

- A bot's eye is 1.62 above its feet.
- So a TOP face can be clicked only up to feet + 1.62, and a cell can sit at most one block above the stand.
- From the pad (feet y 1), nothing above y 2 can be placed. From house@1's raised step ring (feet y 2), y 3 is the
  limit, which is exactly the flat roof.
- A side face can chain a course sideways, but the first block of each course still needs a top face.

So any pitched roof needs one of three things: stands higher than the floor (scaffolding, an attic floor, the roof
itself), or clicks the planner does not allow today. Section 4 settles which.

**The showcase records on 11-04:**

| Record | Generation | State |
|---|---|---|
| shop | g3 | complete |
| house1 | g2 | complete |
| storehouse | g2 | complete |
| hall (copper hall) | g22 | open |
| storehub (storage hall) | g55 | open |

- The enchanting workshop is unsited: it waits for the wall extension's X1 plot.
- The extension's three house plots (11 x 11, ids X3..X5) are reserved and empty.

**Showcase stock.** Read from the town index (`town-index-0_70_0.g4.jsonl`), taking the latest observation of each of the
9 containers it has seen:

| Item | Count |
|---|---|
| spruce logs | 93 |
| oak logs | 23 |
| cobblestone | 126 |
| cobbled deepslate | 870 |
| stone bricks | 298 |
| torches | 79 |
| glass panes | 0 |

The control session's brief puts the town's logs at ~400 counting the yard and the halls; the index above is the 9
chests only.

## 2. Paper proof

All runs used sandbox4 (Paper 1.21.8, mineflayer 4.37.1), with the lock taken and released and RCON used for set-up
only. Every case was read back by the server with `execute if block x y z <name>[state]`.

**Orientation** (`sandbox/townstyle/orient-proof.mjs`, record [`paper-orient.jsonl`](townstyle-2026-11-04/paper-orient.jsonl)).
104 cases × 3 reps:

- stairs (oak, stone brick) in every facing × both halves × every support face;
- slabs (both types × faces);
- logs (every axis);
- spruce trapdoors (every facing × both halves);
- a standing lantern.

The bot stands south-west of each cell, so a look at the face points north-east. The cell's state can therefore be
right only if the click carries its own yaw.

| Arm | Server-verified | Stairs | Acknowledged |
|---|---|---|---|
| **cand**: the aimed click (yaw packet + block_place in one write, cursor at the half) | **312/312** | 216/216 | 312/312 |
| lookat: today's actuator (look at the face centre, cursor at the centre) | 90/312 | 30/216 | 312/312 |
| race: the yaw set by `bot.look(force)`, the click in the same tick | 150/312 | 54/216 | 312/312 |

The two controls show the instrument sees wrong states. They also show the race is total: mineflayer's
`lookAt(force)` only queues its look packet for the next physics tick. Every stair in those arms took the yaw of the
preceding teleport (south): 54 of 216 = the south-facing quarter.

**Blind clicks** (`--scene=blind`, [`paper-blind.jsonl`](townstyle-2026-11-04/paper-blind.jsonl)): 49 cases × 3 = **147/147**.

- top faces 0.4 / 1.4 / 2.4 above the eye;
- side faces clicked from behind their plane;
- a face whose sight line crosses a solid block;
- covering stairs in both halves, slabs and planks, all states right.

Paper places on reach alone. It checks neither the eye side nor the sight line.

**End to end** (`sandbox/townstyle/cottage-e2e.mjs`, [`paper-cottage.jsonl`](townstyle-2026-11-04/paper-cottage.jsonl)).
A real bot built the cottage with the bots' own code: `siteBlueprint` on its own world read, `runVisit`, and
`botBuildEffects` with mineflayer-pathfinder walks. The kit was given by RCON, so the skill wrapper's bill and crafts
were not run.

- **5 of 5 runs PASS.** cottage@1s was built twice and @1f three times.
- Each build finished in one visit of 88-93 s.
- 159/159 and 158/158 cells were server-verified, including all 65 and 64 state cells. Nothing was refused and no click
  went unanswered.
- In three runs, one roof stair was set by RCON with its facing reversed. Each time it was dug (`kind=reorient`) and
  placed again right.

## 3. Codex's independent design

Codex wrote its design from the measurements and the goal, not from this one. It is in full in
[`townstyle-2026-11-04/codex-design.md`](townstyle-2026-11-04/codex-design.md). The prompt asked for: the style
vocabulary, the state data model, the orientation actuator and its proof, build order and supports, materials, the
tripwire and retrofit, and the rollout.

Codex's main points:

- **First piece:** "small style library plus `house@2`", with front gables, timber posts, a stone foundation and slab
  sills.
- **Data model:** cells carry local states that rotate with the record. The resolved palette is persisted in the
  record, so a repair never re-rolls.
- **Done rule:** every specified property must match. A wrong-state block must be removed, confirmed as air, then
  replaced.
- **Actuator:** await an outgoing rotation packet; yaw and sight line must be jointly feasible.
- **Proof wanted:** every rotation, half and support, with stale-yaw, wrong-cursor and missing-support negative
  controls.
- **Staging:** temporary exterior staging blocks for reach, recorded and removed again.
- **Bill:** six roofs take about 363 logs, so no town-wide batch.
- **Tripwire:** H8 must decode states. Retrofit through linked record generations with exact old-roof clear lists and
  preimages, one occupied building at a time.
- **Risks:** rotation timing, partial-block collision, staging reach, concurrent closures, and destructive replay of
  retrofit clears.

## 4. Reconciliation

| Question | Claude | Codex | Chosen, and why |
|---|---|---|---|
| First building | house-size cottage on the extension's house plot | `house@2` | **Agree.** Plot X3, after the enchanting workshop. |
| State in records | local `st` → world `ws` at placement; `stateOk` on named properties | the same, with derived `shape` checked too | **Claude.** The stair `shape` is the server's own (the proof read `straight` throughout). Checking it adds nothing a builder can act on. |
| Yaw timing | write the look packet ourselves, immediately before the block_place, in the same synchronous write | await an outgoing rotation packet | **Claude, from the proof.** The aimed write scored 312/312. The race arm proves a queued look is lost. Writing both packets together keeps buildrun's "nothing awaited between the fence and the send". |
| Yaw vs sight | yaw is free of the stand (the server reads the yaw, not the look direction) | jointly feasible with sight | **Claude, from the proof.** The bot looked north-east and placed every facing right. |
| Reach for the upper roof | **reach-only clicks** for cells at y ≥ 3, interior stands under an open attic | temporary staging blocks, placed and removed | **Claude.** 147/147 blind and 5/5 builds. Staging adds scaffold cells, removal digs, a tripwire rule and fall risk. **Owner decision O2 below**: a client could not make these clicks; Paper accepts them. |
| Misoriented block | dug as `reorient`, placed again, aimed | remove, confirm air, replace | **Agree.** The dig is confirmed by the server like any dig. |
| A click that lands wrong | booked as placed (`misplaced`), then reoriented | the outcome is the server's state | **Agree.** Taken from the Claude r1 review note: without it, one bad click is a G8 bag_loss TRIP. |
| Variety | seeded per plot: variant (eaves or gable to the front), wall wood = the town's most-stocked log, a darker roof wood when the town has 32 of it, stone bricks by the seed | seeded validated combinations, resolved once and persisted | **Agree.** The style is chosen at siting and kept in the record's own palette. |
| Wide buildings (halls 11-13 across) | a 1:2 slab roof (`slabRoof`: ridge 3 above the eaves, in reach from the floor) | a 45° gable along the longer side, hips later | **Claude for reach.** A 45° roof over 13 cells puts its ridge 6-7 above the eaves, out of reach even with blind clicks. The slab roof is pictured. |
| Conformance (H8) | the workshop's only today: decode states when a styled workshop exists | decode states now, zero mismatches for styled buildings | **Deferred to piece 3** (the retrofit). The cottage is not under H8. |
| Retrofit | linked generation, a clear list of the old roof cells, `retired` cells | the same, plus evacuation, preimages, one building at a time | **Agree.** Codex's preimage and one-at-a-time rules are adopted for piece 3. |

## 5. The design

### 5.1 The style library (`bots/src/townstyle.mjs`, pure)

**Orientation:**

- `worldState(st, orient)`: a cell's local state (facing `+u/-u/+v/-v`, axis `u/v/y`, half, type, open, hanging) →
  its world state, through townplan's `rot`.
- `orientAim(name, ws, face)` → `{ yaw, cursor }` or null. These are the 1.21 rules the proof measured:
  - stairs: facing comes from the yaw; half from an underside click, or a side face clicked above its middle;
  - slabs: the same rule for type, and never double;
  - logs: the axis is the face's axis;
  - trapdoors: a side face only, facing the face direction, half by the cursor;
  - lanterns: hanging only from an underside.
- `stateOk(props, ws)`: every property the cell names must read so. The rest (shape, waterlogged) is the server's.

**Shapes:**

- `gableRoof(box, yTop, {ridge, over})`: 45° courses of bottom stairs facing the ridge, one block of eaves all round,
  an odd span capped by a ridge row of bottom slabs, and the gable ends filled under the roof.
- `slabRoof`: the 1:2 roof for wide buildings. Every shared face is closed, and the end-wall cells are full blocks so
  the gable has no half-block notch.

**Style:** `styleOf(town, {key, need, variants})` and `stylePalette` (tokens `%wood`, `%roof`, `%stone`).

**Materials:** `woodPartsPlan` gives the crafts in whole recipes: stairs 6→4, slabs 3→6, trapdoors 6→2.

### 5.2 The actuator and the builder (buildbot / buildsite / buildrun)

- **buildbot `send(support, face, seq, aim)`.** Writes `look {yaw, pitch}` and then `block_place {cursor = aim.cursor}`
  back to back. `look(support, face, aim)` also turns mineflayer's own yaw, so its next physics packet agrees.
- **buildsite.**
  - `placeBlueprint` adds `ws`.
  - `stepFor(..., want)` takes only a face that makes the state, and returns the step's `aim`.
  - A `blind` cell keeps the reach rule (4.5 to the face centre) but drops the eye-side and sight-line rules.
  - `proveSite` carries `ws` and `blind` into the record's cells, so the siting proof is the visit's rule.
- **buildrun.**
  - `cellDone(b, palette, role, ws)`.
  - The click re-proves with the state and sends aimed.
  - A misoriented own block (the role's family, wrong state) joins the foreign digs as `kind=reorient`.
  - A click that lands wrong is `misplaced`: booked as placed, one attempt spent.
  - Place rows carry `st=`.
  - **Cells without `st` or `blind` behave exactly as before.** Every new branch is gated on them. The Claude r1
    review checked this path by path.

### 5.3 The cottage (`bots/src/cottage.mjs`, `blueprints/cottage@1s.json` / `cottage@1f.json`, generated by `bots/scripts/make-cottage.mjs`)

**The building:** a 7×7 pad and a 5×5 room 3 high, with:

- a cobblestone or stone-brick course at y 1;
- spruce (the town's wood) **log corner posts**, axis y, from y 1 to 3;
- plank walls;
- glass windows, falling back to planks when the town has no glass;
- **closed trapdoor sills** under the windows;
- **wall torches either side of the open doorway**, and a torch inside;
- a **45° gable roof**: 42 stairs plus a 7-slab ridge, eaves all round, filled gables with an **attic window**. The ridge
  is at y 6.

**Variants:**

- `s`: eaves to the front, the gables to the sides.
- `f`: the classic gable front, with the door under the attic window.

**Bill** (spruce, cobblestone): 60 cobblestone, 12 logs, 25-26 planks, 42 stairs, 7 slabs, 3-4 trapdoors, 5-6 panes
and 3 torches. That is about **40 logs** in all: 109 planks plus the posts.

**The project and its order:**

- `cottage1` sites on the first free house plot of the wall extension, after the enchanting workshop.
- **Owner order 11-04:** workshop → town hall → houses. There is no town-hall design yet; see O1.
- It waits for that plot (`plot_wait`, then a 30-minute town-wide `site_wait` after a failed siting, the enchanting
  workshop's rule).
- The record keeps its style and its resolved palette. The visit, the bill and the damage read all use that palette.
- The visit draws the roof wood's logs and crafts the planks and the parts at the start of a workable visit, booked in
  `crafted` like the stations.
- `COTTAGE=off` is the rollback. It is on only in the showcase pool (`COTTAGE_POOLS`).

### 5.4 Tripwire (main: `shopread.py.txt`, NOT installed)

**RO1 reorient.** A `_build op=clear kind=reorient` is on the record only when all four hold:

1. the cell is a record cell that names a world state (`ws`);
2. it is a cell of a generation of the plot's chain;
3. the dug block is an oriented block;
4. the block is one of that cell's role names in that generation's own palette.

A generation without a palette authorizes nothing (Codex r1 BLOCKER, fixed). Anything else is clear_outside.

**Evidence for RO1:** the selftest, and the mutants at **162/162 killed** (the 6 RO1 mutants among them), on
`shopread.py.txt` as committed.

**What needs no rule:** the cottage's places, foreign digs and replants are G1 and G2 as for every record. A misplaced
landing is a `place` row on a record cell, so it falls under G1.

**Install.** The showcase tripwire must have RO1 installed before the cottage stages. Without it, the first reorient dig
TRIPs H2.

## 6. Pieces, tiers, queue

1. **townstyle-01, the cottage (this piece).**
   - Showcase lane, not protected (`protected.py`: "not protected"), one Codex round plus a Claude second engine
     (needed for the tripwire).
   - **READY TO STAGE** after the RO1 install. The suite is in the ledger row.
   - **Placement.**
     - Claude: fold with the next showcase restack after the enchanting workshop is sited. The cottage waits for its
       turn (`after: enchantshop`), so staging early costs nothing.
     - Codex: one building type at a time (this one).
2. **townstyle-02, the workshop, the copper hall and the storage hall on new blueprint generations.**
   - The 45° gable for the 9-wide workshop.
   - `slabRoof` for the 13-15-wide halls (the storage hall is pictured).
   - The enchanting workshop gets a slab roof on its record before it is built, if it is still unsited then.
   - Showcase lane. Each building gets a Paper e2e like this one.
3. **townstyle-03, the retrofit of the standing flat roofs** (storehouse, house1, copper hall, storage hall), one building
   at a time. For each:
   - a new record generation: the old roof cells become a `clear` list with their preimages (`kind=reroof`), the new
     roof and gables are cells;
   - the contents and doors are untouched (no cell below the old roof changes);
   - the visit evacuates the work envelope, digs the old roof row by row as the new courses go up, and never opens the
     interior to the sky longer than one course;
   - H8 (conformance) decodes states for styled records before any retrofit completes.
   - Tripwire rule RR1 `reroof`: a clear of a cell on the generation's reroof list whose block is the preimage. It needs
     two engines.
   - Codex's rules: preimages, no replay of clears onto new work, and fresh conformance for the new generation.
4. **Later:** dormers and chimneys on the halls, hanging lanterns (needs an above-support step, not proven),
   market awnings over the yards, and hip roofs. Not before 2-3 are read.

## 7. Owner decisions

- **O1, order.** The town hall (owner order step 2) has no design yet. Should cottages go up on the house plots once the
  enchanting workshop stands? Recommended: yes. The alternative is to wait for a town-hall design; cottage1 is
  `after: enchantshop` and the field changes in one line.
- **O2, reach-only clicks.** The upper roof is placed by clicks a human client could not make: a top face above the eye,
  or a face out of sight. Paper accepts them (147/147); no admin command is involved. The alternative is temporary
  staging blocks: slower, more cells to clear, a tripwire rule, and fall risk. Recommended: accept for roofs.
- **O3, wood.** A cottage takes about 40 logs, and roofs for the four big buildings about 300 more (Codex: about 363 for
  six). Recommended: one building at a time, so the tree farm keeps up.

## 8. Not done in this piece (named)

- The skill wrapper's bill, draws and crafts (skills.mjs) did not run on Paper. Only the visit did, with an RCON kit.
- The first live cottage visit is the read for it. Watch for `_build_bag` crafted rows, `no_material`, and a missing
  crafting table at the plot.
- The cottage always tries the FIRST free house plot. A plot that can never be sited retries every 30 minutes (Claude r1
  note 3; the enchanting workshop's pattern).

## 9. 2026-11-05: the control session's answers and the gap closed

**The answers.** The owner left these three to the control session, which settled them on 11-05:

- **O1 yes.** Cottages go up once the enchanting workshop stands. Houses do not wait for the town hall.
- **O2 yes.** Roofs may use clicks the server accepts on reach alone. No scaffolding.
- **O3 yes.** One roofed building at a time.

The batch takes townstyle-01 with RO1.

**The skill wrapper, run on Paper** (`sandbox/townstyle/cottage-skill-e2e.mjs`,
[`paper-cottage-skill.jsonl`](townstyle-2026-11-04/paper-cottage-skill.jsonl)). This is the real `SKILLS.build_shop`, with no
kit given by RCON:

- the town's chests held logs, cobblestone and torches only;
- the earlier projects were published as complete records;
- the wall extension had one house plot.

It **passed**:

- The order reached `cottage1` and sited cottage@1f in spruce, read from the town index.
- It drew 41 logs under the project reserve.
- It crafted planks, then 44 stairs, 12 slabs and 4 trapdoors at the table: 44 server-verified crafts.
- It built the cottage in 4 visits. 158/158 cells and every state were server-verified, and every `_build_bag` row balanced.

The run found three defects, each of which would have left a cottage stuck. All are fixed in 937226c4 (Codex r3: no
blockers).

| # | What happened | Fix |
|---|---|---|
| 1 | An index that knew no logs yet sited an oak cottage in a spruce town. Its posts waited for oak for good. | Siting refuses `stock_unknown` until the index knows logs. |
| 2 | The first visit crafted the whole roof, so the walls' planks became stairs. The walls stopped `no_material` with 44 stairs in the bag. | Only the parts of segments workable now are planned. |
| 3 | The project reserve let 5 logs through, and a 44-stair craft then failed whole. | Each part craft is cut to whole recipes of the planks in the bag. |

**Measured, and worth the owner's eye:** the project reserve keeps 20% of `BUILD_RESERVE.logs` (512), which is 103 logs. With
the showcase index at 116 logs (9 chests), a cottage can draw only about 13 logs until the tree farm or the yard raises
stock. The cottage waits; it does not fail.

## 10. townstyle-02: the re-roofed blueprints and the town hall (branch townstyle-01show, after 937226c4)

**New blueprints.** `townstyle.mjs restyleRoof` re-roofs a standing blueprint. Everything below the old roof stays exactly as
it is in the @1 file (test).

| Blueprint | Roof |
|---|---|
| `workshop@2` | 45° gable |
| `hall@2`, `storehub@2`, `enchantshop@2` | 1:2 slab roof; ridge at y 6, in reach from the floor |

`townhall@1` (`townhallBlueprint`) is for plot X2 (13 x 19):

- an 11 x 17 pad;
- a 9 x 14 timber-framed hall, with log posts every few blocks and plank walls 3 high;
- windows with trapdoor sills;
- a 3-wide doorway in the front gable, under a round attic window;
- a porch with two log posts and a slab canopy;
- 12 stair pews either side of an aisle;
- a slab roof.

The `townhall` project (`townhall.mjs`) waits for X2 and comes after the enchanting workshop. `TOWNHALL=off` turns it off.

**Pictures:** [`townstyle-sheet.png`](townstyle-2026-11-04/townstyle-sheet.png), with each before and after, plus
`townstyle-<id>.png` per blueprint.

**Paper build test for each** (`cottage-e2e.mjs BLUEPRINT=<id>`, [`paper-townstyle02.jsonl`](townstyle-2026-11-04/paper-townstyle02.jsonl)):

| Blueprint | Cells server-verified with state | Notes |
|---|---|---|
| workshop@2 | 223/223 | a misoriented stair was reoriented |
| townhall@1 | 538/538 | |
| hall@2 | 593/593 | |
| storehub@2 | 643/643 | |
| enchantshop@2 | 567/567 | |

None of these runs refused a click.

**The defect these runs found: slabs merge.** A slab held against a half-full slab of the same kind, clicked on its open half,
replaces the SUPPORT. Vanilla's `SlabBlock.canBeReplaced` turns the support into a double slab, and the target cell stays air.

- The first hall@2 run made 52 reorient digs and never finished the roof edge.
- **Fix:** `buildsite.mjs stepFor` never picks such a support (`townstyle.mjs slabMerges`). The proof's overlay now carries the
  states of placed cells.
- **Tests:** the fake vanilla now merges the way the server does. hall@2 builds whole on it, and the guard's mutant shows the
  proof planning merging clicks.
- The jsonl keeps the failed run and two runs whose verifier rejected valid `$planks` fallbacks (walls and the ridge beam in
  another wood species), above the passing reruns.
- **The cottage is not affected:** its slab ridge is a row of bottom slabs clicked below their middle. Its 5/5 runs stand.

**Reviews:**

- Codex r4: one blocker (the retrofit, section 11). Codex r5: no blockers.
- Claude r1 (second engine): two blockers (section 11) plus notes. It confirmed the slab guard matches vanilla, and RT1 and H8.

## 11. townstyle-03: the retrofit, one building at a time

**The retrofit digs nothing.** A standing flat-roofed record gets a new generation of its own record:

- every old cell stays, where it is and as it is;
- the old flat roof becomes the ceiling under the new one;
- the pitched roof is added above it (`reroof.mjs`; `restyleRoof keepFlat`; new roles `roofstair`, `ridge`, `roofslab`,
  `ridgebeam` and `gable`, which never collide with an @1 role).

What the record keeps and gains:

- It keeps its blueprint id, so the storage hall's clerk, the copper hall's domain and the enchanting workshop's fit-out are
  unchanged.
- It gains `style`, its own `palette`, and `restyle`.
- It stays complete. The added roof reads as damage, and the building's own visit repairs it first. An open record would switch
  off the workshop's stations, the hall's clerk and the fitter (Claude r1 note).

**The planner.** A project, `reroof`, publishes the next building in this order:

1. house1
2. shop
3. storehub
4. hall
5. enchantshop

It publishes only when four things hold:

- no styled build is open (a cottage, the town hall, or an earlier retrofit roof still reading damaged);
- the town's logs are known;
- the town has the logs the roof needs;
- the building's added roof is proven on the standing world.

The proof is `proveSite` over the added cells, with the interior minus every cell the building fills and every fit slot. That
last part was the blocker both engines found: without it the workshop, both halls and the enchanting workshop failed
`interior_unreachable`. The planner waits through its 30-minute town-wide wait (Claude r1 blocker), and passes over a building
whose proof fails 3 times. `REROOF=off` turns it off.

**Paper** ([`paper-reroof.jsonl`](townstyle-2026-11-04/paper-reroof.jsonl)): each building was built flat, then given its
retrofit generation, then built again.

| Building | Cells server-verified, old and new | Added roof cells | Dug |
|---|---|---|---|
| house@1 | 185/185 | 57, in one visit | nothing |
| workshop@1 | 238/238 | 71, in one visit | nothing |
| storehub@1 | 748/748 | 221, in one visit | nothing |
| hall@1 | 692/692 | 215, in one visit | nothing |

**Tripwire** (main, NOT installed):

- **RT1.** The retrofit needs no new rule. Its placements are G1's against the head generation, and a misoriented new stair is
  RO1's. The selftest pins it, and the mutants stay at 162/162.
- **H8** (`scripts/host/shopconform.py`). The conformance survey now reads block states. A state cell is done only in its state,
  read from the region palette entry's `Properties`, and a styled record is judged by its own palette. 4/4 anchored mutants
  (`scripts/host/test_shopconform_states.py`).
- **Expect a dip during the retrofit.** While the workshop's roof is open, its surveys score below 0.98, and `exposure_ready`
  drops until two good surveys of the new generation. That is fail-closed, never a trip (Claude r1 note).
