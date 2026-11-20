# Step well trace, 2026-11-20 (stepwell-03show, phase 1: diagnosis)

**Question.** The showcase step well (record `project-0_70_0.stepwell` g28, open) has 484 of 2,168 cells placed, all on
11-13. Since 11-14 it has had 9 visits and placed nothing. Every visit since 11-16 23:16Z ends the same way:
`1 cell(s) passed this visit at y 70: dug 0, placed 0`. Why?

**Answer in one line.** One dirt block that another bot left floating at **-58,70,-74** blocks the whole tank. The block
is a listed cut on the y=70 layer, the layers go strictly top down, and the only stands that reach it are three more
floating dirt blocks. No walk can get there, so every visit passes the cell, ends `passed`, and the project is then
held for 6 h.

## Sources and method

| What | Where | As of |
|---|---|---|
| Record g28 + stuck, lease, presence files | ci2 `~/pool-1119b/_pool-showcase` | 11-19 18:18Z |
| Saved region `r.-1.-1.mca` (covers the whole box -65..-43, -85..-63) | ci2 `~/world18full/region` | 11-18 12:36Z |
| Bot rows (all 15 showcase bots, rotated files 11-06..11-19 included) | ci2 `~/showlogs-1119b` | to 11-19 18:18Z |

- The region is older than the last visits, but nothing has been dug or placed in the step well since 11-16 16:00Z.
  Every visit after that was `0d/0p`, so the saved world is the world those visits saw.
- The 11-20 06:00Z visit is not in my copy. It is taken from the brief, and its text matches the five before it.
- ES carries no showcase rows: `prefix bot.name: showcase` returned 0 hits. All reads below come from the file copies.
- Two tools are new on this branch:
  - `bots/scripts/stepwell-trace.mjs` (the first undone unit and its stands)
  - `bots/scripts/stepwell-visit-replay.mjs` (the REAL `runStepwellVisit` loop over the region; each walk is driven by
    the REAL mineflayer-pathfinder under prismarine-physics, through `wellstand-replay.mjs fakeBot`)
- The replay walks with the town-deposit profile that `stairWalk` uses: no digs, no towers, no scaffold, drop 6, no
  parkour. Digs and placements are instant on a simulated clock (1 s per op, a walk counts its ticks / 20). The budget
  is 120 s per visit, the length of the live visits (Comet's `time` stop came at 127 s).

## 1. The blocking cell

`stepwell-trace.mjs` on g28 + region:

```
site g=62 T=2 W=23 box=-65,-85,-43,-63 minY=15 top=71 units=180 cells=2168 cuts=3659 exit=-54,62,-62 descent=true
fellPending=0 tiersDone= tiers_built=
units done=4 undone=176 unknown=0
first undone unit i=1 y=70 cut=83 faces=0 under=0 tops=0 posts=0 lights=0
dig cut cut at -58,70,-74 now=dirt below=air stands=3 -59,71,-76 -59,71,-75 -59,71,-74
```

- Of unit y=70's 83 listed cuts, 82 read open. The one that does not is **-58,70,-74, dirt, air under it.** Units y71,
  y69, y68 and y67 read done. Every deeper unit waits on this one cell, because `firstUndoneUnit` and
  `runStepwellVisit` work only the first undone unit.
- `standsFor` offers three stands, -59,71,-76/-75/-74. Their floors are dirt at -59,70,-76/-75/-74, and all three hang
  over the dug pit: air under each, down past y=61.
- **Real-route replay, the positive control.** Started at the record's exit, two visits on the current world each give
  `walk -> -59,71,-74: 400 ticks, not arrived (rests at -62,65,-74)`, then a second `walk_failed`. Each visit ends
  `stop=passed y=70 dug=0 placed=0 skipped=1` after 20 simulated seconds. This is the live sequence exactly: two
  `_stepwell op=refused at=-58,70,-74 why=walk_failed`, then `op=visit y=70 why=passed n=0d/0p/0o/1s`. Live, that
  happened 11-16 23:16Z (Iris), 11-17 09:08Z (Alpha), 11-19 11:54Z (Juno), 11-19 17:56Z (Iris), and 11-20 06:00Z per the
  brief.
- **No ground stand is within reach.** I searched every column within 6 for its highest supported floor, leaving out the
  bridge dirt. The best real floors are the pit bottom at feet y=61, and they need a **rise of 5** to come within
  `standReach` 3.8. One column, -56,66,-71, needs a rise of 2, but its floor is a floating cobblestone at -56,65,-71,
  itself over air.

## 2. How the block got there

Maple's rows, 11-16 17:34-17:41Z (`showcase-Maple` file for 11-17):

- At 17:32:45 an idle `explore` headed for a known iron ore. It walked straight across the step well's dug pit at
  y=71, bridging with the pathfinder's own scaffold (`_place_town_sum ... out.pathfinder.pillar.placed 5`).
- Next came four `_explore_blind_step_refused blind_step: drop of 10 ahead`, at 17:35:26-43, at -58,71,-75 and around it.
- `_takeback` (takeback-01show) dug 12 of the bridge blocks behind it: `outcome=dug why=ripe`, at -55,70,-68 through
  -59,70,-77.
- At 17:40:55 it gave up on the last four. Maple was by then at -56,43,19: `outcome=left why=expired` for
  **-58,70,-74, -59,70,-74, -59,70,-75, -59,70,-76** (age ~5 min).

The step well's own visit at 11-16 15:58-16:00Z (Comet) had dug 35 cuts on y=67..64, so unit y=70 was done then. Maple
reopened it 95 minutes later. The region holds more bridge leftovers over the pit: 84 solid blocks over air above the
court inside the box, most at y=70. Only -58,70,-74 is a listed cut. The others are not the step well's, and they block
nothing (they are tidy's).

## 3. Each suspect, checked

| Suspect from the brief | Finding |
|---|---|
| A cell with no stand | **Not that.** The cell has 3 stands by `standsFor`, but every stand floats, so it is a **walk/route failure**: `walk_failed` x2 each visit. The real pathfinder never gets near (§1). |
| TEMPSTAND did not take it | TEMPSTAND is wired only into `buildrun.mjs visitInner`, for **placement** cells. `runStepwellVisit` (the tank) never calls it, and this cell is a **dig**. TEMPSTAND also rises ≤3, and the least rise from real ground is 5 (§1). It could not have helped. |
| Stale plan cells (felling scaffold, logs that are gone) | **Not the blocker now.** `fellPending=0`, and each visit's `_stepwell op=fell_done` says `tank:pending0/owed0 ... trees8/gone8/standing0 ... stands5/obsolete5` (felldone-01 is live). The tank phase runs. The planvalid "step-well reconcile" from the memory notes was about the felling phase, and felldone already covers it. |
| The tier gate | **Yes, at the layer level.** The tank works only the first undone unit, top down. A unit whose only undone cell is passed ends the visit `passed`. Nothing below y=70 is ever offered, although units y66..y59 all have reachable stands (§4). |
| The 6 h stuck hold | **Yes, it multiplies the cost.** A visit that did nothing and stopped `passed` writes `projStuckWrite(..., {}, {stuckAt})` with **no cells** (`skills.mjs` ~33056). That holds every bot off the project for `SHOP_STUCK_RETRY_MS` (6 h; `stuckBackoff` / `buildOrderOwn`). The stamp names no cell, so the `stale` rules (felldone's `fellStampStale` among them) can never drop it. projturn also adds its own back-off on each holder's turn file: `_shop_turn op=backoff n=4 until_min=169` at 11-19 17:56Z, doubling to a 6 h cap. Result: 5 visits in ~79 h, each one 60-75 s of walking and then nothing. The stamps from 11-19 17:56Z and 11-20 06:00Z will still hold the project for hours after any fix goes live. This is the 11-12 lesson again: a hold outlives the release that fixes its cause. |

## 4. What happens past the cell (counterfactual on the real region)

`stepwell-visit-replay.mjs --air -58,70,-74 --visits 14` treats the cell as set aside. It runs the same loop, region and
walks:

```
visit 1: stop=time dug=22 placed=0  refused=4 -> next unit y=65
visit 2: stop=time dug=29 placed=0  refused=3 -> y=63
visit 3: stop=time dug=42 placed=10 refused=1 -> y=61
visit 4: stop=time dug=61 placed=26          -> y=60
visit 5..7:        dug 74/73/38 placed 0/0/33 -> y=60
visit 8..10:       dug 69/69/49 placed 4/0/17 -> y=59
visit 11..14:      dug 68/50/43/38 placed 14/37/44/39 -> y=58 (tier 2)
```

- Every unit from y66 down to y59 completes. Each visit does 22-87 ops, ending on the visit clock, and none ends
  `passed` again.
- The other `walk_failed` refusals (-45,66,-85; -49,65,-66; -47,65,-66; -65,64,-74; ...) are passed for one visit and
  then taken from another stand on the next. That is the loop's normal case, not a dead end.
- Caveat: digs and placements are instant and always succeed in the replay. Live visits will do fewer ops (dig time,
  click acks). The point is the shape: work flows layer after layer.
- Replay artefact, fixed: `Block.fromString('cobblestone_wall')` defaults to waterlogged=true. The replay now places dry
  walls; before the fix, a wet post looked unsealable and stopped the replay at y=61.

## 5. Cause chain

1. The tank cuts its layers strictly top down. That order is the safety rule: liquids are surveyed and sealed first,
   and nothing is cut under an uncut layer.
2. A bot's exploration bridged across the already-dug pit at y=70. The takeback expired on 4 blocks, and one of them is
   a listed cut of layer y=70.
3. The only stands in reach of that cut are the other 3 floating blocks. No walk reaches them, and no real floor is
   within a rise of 5. The cut can never be dug with this profile.
4. The visit passes the cell twice, ends `passed` with no work, and stamps a project-wide 6 h hold with no cells. The
   turn back-off adds up to 6 h more.
5. Every later visit repeats steps 3-4. Two correct guards (top down, and the stand must be walked to) compose into a
   dead end.

## 6. The fix (proposed, not built)

Small, on the live release db59a782 (wellfix-01show-rel):

1. **Set aside a proven-unreachable cut, and let the layer below go on** (`stepwellvisit.mjs` / `stepwell.mjs`).
   - Which cells: a **cut** cell (dig only, never a face, top or post placement) that this visit proved it cannot reach.
     The proof is either no stand at all, or every stand offered has `walk_failed`.
   - Conditions: the cell holds a **solid, non-falling, dry** block, has no liquid among its six neighbours, and is not
     lava.
   - Effect: the cell is **set aside** for the visit. It is held, never waived, never removed from the record, and
     re-tried first on every visit, because the top-down scan still offers it. Each visit writes one
     `_stepwell op=set_aside at= why=no_stand|walk_failed y=` row, the way T11 writes its `cave_deferred` rows.
   - The unit then counts as done for the order, like `litOff` for torches, and the visit works the next unit.
   - Safety: a dry, non-falling block left above a deeper cut cannot fall or flow into it, so the order still holds for
     everything that can. A falling or wet cell still holds the layer, as now.
   - `tiersDone` and completion still count the cell as owed. It stays honest on the record. Completion is far off
     (tier 2 + descent).
   - Tests: the composed chain on a fake world. A floating cut whose only stands fail their walk must leave the next
     layer worked. A floating SAND cut must still hold. A wet neighbour must still hold. Mutants, anchored, for each
     guard.
2. **The hold does not outlive a release or the cell.**
   - The tank's `passed` stamp names its passed cells and the code version.
   - For the step well, the `stale` rule drops a stamp when its cells read done or set aside, or when the stamp was
     written by another code version. Today's no-cell stamps are dropped too, so the fix is exercised as soon as it is
     live.
   - The step well's projturn no-progress entries written before the release get the same release rule, if the turn
     file carries enough to tell (to check while building).
3. **Not in this fix, noted:**
   - Torches for the lights come from indexfetch, which is not on this base. Today 1 torch is drawn
     (`short=torch:7`) and the lights are passed (`lights_passed`).
   - The mess source: `explore` bridges over a project pit, and the takeback expires after ~5 min once the bot has
     left. 4 of 16 blocks were left here.
   - The ~80 other floating bridge blocks over the pit belong to tidy, not the step well.

Acceptance:

- The visit replay on this region with the fix: visits advance past y=70 (no `--air`) and log `set_aside` rows.
- The Paper rig on the real region (sandbox2, the T11 recipe) shows blocks placed per visit and layers advancing.
