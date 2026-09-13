# Flooded-pocket rung — design v3 FINAL (13 Sep 2026; two Codex passes, both folded in; no further review — build against Bravo's fixture)

Raw `bot.dig` / `bot.placeBlock` only; the pathfinder refuses blocks touching liquid and cannot jump-place in water.
Fixture: board-c-Bravo (floating at y=48.2 in a 5-deep water pocket, floor y=44, stone y=50 to ~62, 25 blocks, no
tools, an air cell it breathes from).

1. **Feasibility from the FLOOR, before anything moves.** Column need = (first dry opening y, by climbNeedAbove,
   scanned from the floor) − floor y. Blocks needed = need + 2; time = Σ per-block dig cost priced for the real
   state (standing on the pillar, head submerged until the surface: bare-hand stone 7.5 s × 5 = 37.5 s each while
   the head is in water, 7.5 s above it) + placements. Refuse when blocks or time (cap 240 s) are infeasible, or
   when any cell to be dug has a liquid or lava neighbour other than the pocket's own water below it (lateral
   inflow), or when no floor lies within 6 below. Every refusal is named.
2. **Ownership and air.** The rung takes the body (`claimBody('pillar')`); the air reflex does not run while the
   claim is held, and the rung enforces its own oxygen rule: if `bot.oxygenLevel` ≤ 6 (a third of 20) it releases
   the claim, sets jump, and lets the air reflex surface the bot to its air cell — the descent may only start when
   the return route to that cell is the straight column the bot just left (record the air cell; no other route is
   assumed). If oxygen reaches the abort level twice, the rung is exhausted for 10 min.
3. **Sink** by releasing jump and holding sneak released: prismarine-physics sinks with gravity when jump is not
   held; wait until `bot.entity.onGround` is true AND the feet cell is directly above the floor block (verify with
   blockAt, not only onGround), or 8 s → abort to air.
4. **Pillar from the floor.** Reference = the block under the feet. Hold jump; when the feet are ≥ 1.0 above the
   reference's top AND the body no longer overlaps the target cell (feet y ≥ reference top + 1.0 for a full cube,
   the mineflayer placement rule: the placed cell must be free of the entity), `placeBlock(reference, up)`; verify
   the target cell became solid within 500 ms; then wait until onGround on the new block (supported height), then
   release jump. Progress = supported height gained ≥ 0.9 per step; 3 failed steps → abort.
5. **Ceiling.** Before each step, if the cell two above the feet is not passable, dig it first (digHand priced
   grounded-hardness / situational budget) while standing supported; refuse if that cell or any of its exposed
   neighbours would let liquid in (rule 1's inflow test, re-checked live). The body never rises into stone.
6. **Postcondition and end.** `escapedFrom` (≥ 4 up and dry) AND the head cell breathable AND the feet supported;
   "opening reached" alone is not the end. On any abort: `stopDigging`, clear all control states, release the
   claim, invalidate the step loop (a generation counter so a late `placeBlock` resolution cannot act), log
   `flooded_pocket_rung` with the reason and blocks spent.
7. **Budgets.** Wall clock 240 s (from the feasibility estimate, capped); blocks capped at need + 2 (counted from the
   floor); one attempt per 10 min per bot; the whole rung is one ESCAPE episode in the movement owner.

## v3 — the final pass's four defects, folded in

- **Jump release (step 4):** release jump immediately after the placement is confirmed, then await a supported
  landing (onGround on the new block) with a 1.5 s deadline; holding jump keeps the bot swimming upward.
- **Oxygen feasibility per operation (steps 1, 5):** every uninterrupted submerged operation (a dig or a
  placement sequence) plus the swim back to air must fit the available oxygen (`bot.oxygenLevel`, 20 = 15 s).
  A bare-hand submerged stone dig is 37.5 s and can never fit one breath; the rung REFUSES it with the reason
  "submerged dig exceeds one breath" rather than starting. Consequence, recorded honestly: **board-c-Bravo
  (no tool, head submerged under stone) is not recoverable by this rung, nor by any rung without a tool or an
  air layer under the stone; its remedy is prevention — a wooden pickaxe kept in hand — which is the retention
  goal, not a rescue.** Delta-class pockets (a pickaxe in hand: 1.15 s × 5 ≈ 6 s per block) are feasible.
- **Abort order (step 6):** invalidate the step loop and clear controls FIRST, then hand the body to the air reflex
  and confirm the head is breathable before the episode ends; never end an underwater recovery on an abort alone.
- **Cancellation inside placement:** a generation counter cannot stop a `placeBlock` whose look already completed;
  the rung wraps placement so the cancellation check runs immediately before the packet is sent, and after any
  abort it re-reads the target cell to reconcile a placement that went out anyway.
