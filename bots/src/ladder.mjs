/**
 * LADDERS: the capability this fleet already owns and has never once used.
 *
 * Measured today across 80 bots: 27 carry ladders, and 23 of those carry
 * EXACTLY THREE -- one craft (7 sticks -> 3 ladders), made once, incidentally,
 * and never again. No bot holds 25. Meanwhile 64 of 80 could craft 25 or more
 * from the wood already in the pack, the median bot could make 138, and the
 * climb a stranded bot is actually asked for has a median of 24 blocks.
 *
 * `place` was called 44 times in five hours and EVERY ONE was a crafting_table.
 * So this cannot be advice: the model does not place things. If a ladder is
 * ever going up, deterministic code has to put it there.
 *
 * WHY LADDERS AND NOT MORE SCAFFOLD. mineflayer-pathfinder 2.4.5 already treats
 * ladder as a climbable and will route up and down one that exists
 * (movements.js: `this.climbables.add(registry.blocksByName.ladder.id)`), so a
 * placed column is not just a way out, it is a permanent two-way route that the
 * navigator understands without any help from us. Pillaring is one-way, spends
 * a block per level, and leaves a tower that strands the next bot on top of it.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO: it does not tell the exit contract
 * that ladders make a climb affordable. The ChatGPT review named that as the
 * strongest argument against the whole idea and it is right --
 *
 *     "inventory possession is not capability ... bots are now allowed to dig
 *      deeper because the exit contract credits theoretical ladders, but the
 *      physical placement routine fails ... That converts a clean refusal into
 *      a real stranding."
 *
 * A refusal that keeps a bot shallow is cheap. A bot 80 blocks down holding
 * ladders it turns out it cannot place is not. So the placement is proven on
 * bots that are ALREADY stuck, where a failed attempt costs nothing new, and
 * only evidence from that earns a change to the contract.
 */

/**
 * Blocks that are opaque and full-height in the registry but do NOT present a
 * full square side face, so a ladder cannot attach to them.
 *
 * minecraft-data reports boundingBox='block' and transparent=false for fences,
 * slabs, stairs and walls, which makes the obvious two-field test wrong for
 * exactly the blocks a forest and a mineshaft are full of. Checked against
 * 1.21.8: oak_fence, oak_slab, oak_stairs and tnt all pass
 * `boundingBox === 'block' && !transparent` and none of them can hold a ladder.
 */
const PARTIAL_FACE = /(_slab|_stairs|_fence|_gate|_wall|_pane|_door|_trapdoor|_sign|_bars|_carpet|_pressure_plate|piston|chest|anvil|hopper|cake|scaffolding)$|^(tnt|barrier|light|slime_block|honey_block|glass|ice|packed_ice|blue_ice|leaves)$/

/**
 * Can a ladder attach to the SIDE of this block?
 *
 * Minecraft requires the side face of a full, opaque block: not the top or
 * bottom, and not glass, leaves or ice. `transparent` is the field that
 * separates leaves from logs -- both are boundingBox='block' -- and a forest is
 * where this fleet lives, so getting it wrong would fail silently on most walls
 * it meets.
 *
 * Fails CLOSED on anything it cannot identify. A wrong "yes" spends a ladder
 * and leaves a gap in the column, and a column with a gap is not climbable at
 * all -- the pathfinder needs it continuous.
 */
export function canAnchorLadder (block) {
  if (!block || typeof block.name !== 'string') return false
  if (block.boundingBox !== 'block') return false
  if (block.transparent === true) return false
  if (PARTIAL_FACE.test(block.name)) return false
  return true
}

/** Can a ladder be PLACED into this cell? It has to be empty, and not liquid. */
export function ladderCellFree (block) {
  if (!block || typeof block.name !== 'string') return false
  if (block.name === 'water' || block.name === 'lava') return false
  // A ladder already there is not a failure; the column just needs one here.
  if (block.name === 'ladder') return true
  return block.boundingBox === 'empty'
}

/**
 * How far up can a continuous ladder column actually be built from here?
 *
 * `cells[i]` is the cell the ladder would occupy at height i, and `anchors[i]`
 * is the block it would attach to at that height. Returns the height of the
 * first CONTINUOUS run, because a column with a hole in it is not a climbable
 * column: the pathfinder routes a ladder only while it is unbroken, so eight
 * good rungs with a gap at four is worth four, not eight.
 *
 * Pure, and separate from the placing, so "how high can this go" can be tested
 * without a world -- which is the half that decides whether to start at all.
 */
export function ladderReach ({ cells = [], anchors = [] } = {}) {
  let n = 0
  for (let i = 0; i < cells.length; i++) {
    if (!ladderCellFree(cells[i])) break
    if (!canAnchorLadder(anchors[i])) break
    n++
  }
  return n
}

/**
 * Should the bot start building a ladder column at all?
 *
 * Refuses a climb it cannot finish, for the same reason `canFinishClimb`
 * refuses a pillar it cannot finish: a half-built column leaves the bot exactly
 * where it started, holding fewer ladders. The reserve is one, because the top
 * rung is the one that gets mistimed.
 */
export function ladderPlan ({ need = 0, have = 0, reach = 0 } = {}) {
  const n = Math.floor(Number(need)); const h = Math.floor(Number(have)); const r = Math.floor(Number(reach))
  if (!Number.isFinite(n) || n <= 0) return { ok: false, why: 'no climb needed' }
  if (!Number.isFinite(r) || r < n) {
    return { ok: false, why: `wall gives ${Number.isFinite(r) ? r : 0} of the ${n} rungs needed` }
  }
  if (!Number.isFinite(h) || h < n + 1) {
    return { ok: false, why: `${Number.isFinite(h) ? h : 0} ladders against a ${n}-block climb (need ${n + 1} with reserve)` }
  }
  return { ok: true, rungs: n }
}
