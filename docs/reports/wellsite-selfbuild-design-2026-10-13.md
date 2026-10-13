# A junk well that builds its own shell — design note for the owner (2026-10-13, analysis only)

## Why it is needed
The junk well is accepted only where the ground already seals it. All of the following must be solid ground:
- the 8 cells around the shaft, at ground level and one below;
- a 5×5 underground ring 1–3 blocks below;
- the floor.

That geometry is what keeps a thrown item out of every player's pickup reach. It was sized and checked on Paper and should stay as it is.

The bots have dug out the ground around every home, so that ground is no longer there. These figures come from the town region files read offline on 10-13 and checked against read-only RCON (10 of 10 cells):

- **Every town fails.** In all 16 towns, the walls rule or the ring rule fails for 80–100% of candidate cells within 14 blocks of home. That includes the towns that already have a well.
- **The surface is mostly gone.** The soil layer near home is a lattice of floating grass blocks over mined-out dirt, with tunnels in the stone below.
- **It is the bots' digging, not the seed.** Ten worlds share one seed, so their natural terrain is identical. They differ by 677–2,761 bot-dug cells in the town box.
- **Searching further does not fix it.** Widening the search to 32 blocks with the same rule finds a site in only 5 more towns:
  - found: board-a, board-b, isolated-c, isolated-d, hive-d;
  - still none: board-c, board-d, placebo-c, isolated-a, isolated-b.
- **Far cells are not safe either.** Even 41–56 blocks out, only 5–21% of cells have intact walls, and the digging keeps spreading.
- **Built wells get undermined.** board-b's well was breached after it was built, because the soil under its ring was mined out.

A well that only fits on untouched ground stops working in any world bots have lived in. The design has to bring its own ground.

## The idea
Keep the verified geometry exactly as it is, and supply whatever part of it the world is missing, using blocks the bot places itself.

The rule is "the shell is solid". It does not have to be natural ground: a placed cobblestone block is a full, non-falling cube, which is all the rule asks for. So the bot can complete the shell, and the existing site checks (`containmentRefusal`), the breach check before each throw, and the throwing logic all still apply.

## Option A — the raised well (the preferred first prototype)
Build the whole shell above the surface, so no shell cell is ever underground and inaccessible.

- **Where it sits.** Pick any reasonably flat 5×5 patch. Call its surface level `s`.
  - Fill any holes in the 5×5 at level `s`. Each hole is visible from above.
  - Place a 5×5×3 plinth of cobblestone on top, covering levels `s+1` to `s+3`. Leave the centre column open.
- **How the existing well maps onto it:**
  - the cap is at `s+3`;
  - the shaft is at `s+2`;
  - the floor (a placed block) is at `s+1`;
  - the underground ring becomes plinth levels `s+1`, `s+2` and `s+3` plus the filled surface at `s`.
- **Same throwing geometry.** The stand is on top of the plinth, one block above the cap. That is the same relationship as now, so the measured throwing angles and the 1.15-block stand distance carry over unchanged.
- **Getting on top.** A one-block-wide step stair of 3 blocks against one side lets bots walk up. The pathfinder can climb 1 block per step.
- **Construction order.** Every placement is against a top face or a side face of a block already placed, building layer by layer from below. No digging, so no rejected-dig "ghost block" risk.
- **Block count.** About 72 blocks for the plinth, up to 25 for filling surface holes, and 3 for the stair: roughly 75–100 cobblestone per well.

Bots carry far more cobblestone than that. stocktarget-01 is trying to get rid of surplus cobble, so building the plinth is also a useful sink for it.

## Option B — repair in place (smaller and cheaper, but more limited)
Choose a dug-out site whose missing shell cells can all be reached from above. Fill them bottom-up, then dig the shaft.

- In towns that are a lattice of floating grass, the cells under the grass blocks are sealed voids. They can only be filled by digging out each column and rebuilding it, which costs about 4 digs plus 4 placements for each of 24 columns.
- B is cheaper where the ground is nearly intact. It does not help in the towns that actually lack a site.

## What it would take
1. **Pure planner (`well.mjs`).**
   - Input: a site.
   - Output: the ordered list of cells to place, each with a reference face and a standing cell within reach; the stair; and the cobble needed.
   - Accept a site only if every placement has a legal standing cell and face, checked offline on the real town terrain with `bots/scripts/wellsite-replay.mjs`.
2. **Build skill.**
   - Resumable, the same way the current build stages are: the stage is read from the world on every visit.
   - Bounded per visit.
   - The plinth cells are reserved from the moment the site is recorded, like the current well column.
   - An abandoned build is safe: a half-built plinth is just a block of cobble. The shaft is dug, or left open, only in the last step, which the existing pit-cover rule already handles.
3. **Paths and keep-outs.**
   - The plinth top, stand and stair must stay walkable.
   - The well column stays excluded from paths.
   - Bots must never "gather" the plinth: its cells need adding to the never-dig set, as the current ring cells already are.
4. **Sandbox first (Paper 1.21.8, 25599–25602).** Before any review of fleet code, measure:
   - Does the pathfinder use the stair reliably?
   - Do throws from the plinth top land? (Repeat the 528-throw dispose run and the 60-pass walker isolation run.)
   - Is the build itself reliable, with no dropped placements and the resume working?
   - Mob checks only if a world is non-peaceful.

   Then both-engine review, then the usual canary. Its population is the 5 towns that have no cell even at radius 32.
5. **Interactions.**
   - Stocktarget's cobble reserve: building must never take a bag below the 64-stone guard.
   - Chest-full's well keep-out.
   - The exit contract's scaffold blocks.

## Not proposed
- Relaxing the 2-block ring to 1 block. It leaves a body in a distance-2 cell at exactly zero margin from an item pressed against the shaft wall.
- World edits of any kind.
