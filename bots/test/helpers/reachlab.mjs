// scratch harness: real Movements + real goals over synthetic worlds
import mcDataLoader from 'minecraft-data'
import pblock from 'prismarine-block'
import { Movements } from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const { RaycastIterator } = require_('prismarine-world').iterators
const goals = require_('mineflayer-pathfinder').goals

const V = '1.21.8'
const mcData = mcDataLoader(V)
const Block = pblock(V)

export function mkWorld (fn) {
  const cache = new Map()
  const getBlock = p => {
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
    const k = `${x},${y},${z}`
    if (cache.has(k)) return cache.get(k)
    const d = mcData.blocksByName[fn(x, y, z)]
    let b = null
    if (d) { b = Block.fromStateId(d.defaultState, 0); b.position = new Vec3(x, y, z) }
    cache.set(k, b)
    return b
  }
  // prismarine-world's own raycast body (src/worldsync.js:40), same iterator.
  const raycast = (from, direction, range, matcher = null) => {
    const iter = new RaycastIterator(from, direction, range)
    let pos = from
    while (pos) {
      const position = new Vec3(pos.x, pos.y, pos.z)
      const block = getBlock(position)
      if (block) {
        const intersect = iter.intersect(block.shapes, position)
        if (intersect) { block.face = intersect.face; block.intersect = intersect.pos; return block }
      }
      pos = iter.next()
    }
    return null
  }
  return { getBlock, raycast }
}

export function mkBot (world, pos, { items = [] } = {}) {
  const bot = {
    registry: mcData,
    game: { minY: -64 },
    // `effects` and `inventory` are only reached under canDig=true: Movements.safeOrBreak prices the
    // dig through `bot.pathfinder.bestHarvestTool` (movements.js:292) and `bot.entity.effects`
    // (:294). With the travel profile that branch never runs, which is why this stub did without
    // them until the gather profile arrived -- getNeighbors threw
    // "Cannot read properties of undefined (reading 'bestHarvestTool')" and `reachable` swallowed it
    // in its own try/catch, so EVERY scene came back with one node and read as `no_path`.
    // The positive-control fixture is what caught it; a corpus without one would have published that.
    entity: { position: pos.clone(), effects: {} },
    inventory: { items: () => items },
    world,
    blockAt: p => world.getBlock(p),
  }
  // Empty-handed by default, matching `scafoldingBlocks = []`: dig costs are then an UPPER bound and
  // reachability a LOWER bound, which is the safe direction for a kill filter.
  bot.pathfinder = {
    LOSWhenPlacingBlocks: true,
    bestHarvestTool: (block) => {
      let fastest = Number.MAX_VALUE; let best = null
      for (const tool of items) {
        const t = block.digTime(tool ? tool.type : null, false, false, false, [], bot.entity.effects)
        if (t < fastest) { fastest = t; best = tool }
      }
      return best
    },
  }
  return bot
}

export function fleetMovements (bot) {
  const m = new Movements(bot)
  m.canDig = false            // travel profile: index.mjs sets this for bot.pathfinder.movements
  m.allowParkour = false
  m.allow1by1towers = true
  m.maxDropDown = 6
  m.placeCost = 5
  m.liquidCost = 2
  m.allowEntityDetection = false
  m.scafoldingBlocks = []     // an empty-handed bot: nothing to tower with
  return m
}

/**
 * The GATHER profile, mirroring index.mjs:467-482. `fleetMovements` above is the TRAVEL profile
 * (canDig=false, no scaffold) and using it to ask "could gather have broken this?" answers no to
 * everything -- safeToBreak's first line is `if (!this.canDig) return false`.
 *
 * `dontCreateFlow = true` is the flag that produces 37.3% of log-gather refusals, and it is the one
 * this harness exists to reason about. It is set here, not assumed: index.mjs carries a fourteen-line
 * comment about why, ending in five deaths in the 14 bot-hours 6d1fdba ran without it.
 *
 * scafoldingBlocks stays empty. A bot with cobblestone can tower to a target this says is
 * unreachable, so every reachability answer here is a LOWER bound -- which is the safe direction for
 * a kill filter and the wrong direction for a threshold, and this rig is only ever the former.
 */
export function gatherMovements (bot) {
  const m = new Movements(bot)
  m.canDig = true
  m.allowParkour = false
  m.allow1by1towers = true
  m.maxDropDown = 6
  m.dontCreateFlow = true
  m.allowEntityDetection = false
  m.scafoldingBlocks = []
  return m
}

/**
 * A fixture's `cells` map as a reachlab world. `mkWorld` takes (x,y,z) -> block NAME, and the corpus
 * speaks setblock, so the `[state]` suffix is stripped.
 *
 * AN UNRECORDED CELL IS NOT AIR. The captured scenes mark cells that were unloaded at capture time,
 * and mapping those to air turns every chunk-edge refusal into a pass -- a detector that answers
 * uniformly, which is this project's most repeated bug. They map to a name mcData does not know, so
 * `getBlock` returns null, exactly as `bot.blockAt` does off-world.
 */
export function sceneWorld (fx) {
  const cells = fx.cells
  return mkWorld((x, y, z) => {
    const raw = cells[`${x},${y},${z}`]
    if (raw === undefined || raw === '?' || raw === null) return '__unknown__'
    return String(raw).split('[')[0]
  })
}

/** Every node the planner can actually reach from `start`, via the REAL move generator. */
export function reachable (m, start, cap = 6000) {
  const seen = new Map()
  const q = [Object.assign(new Vec3(start.x, start.y, start.z), { remainingBlocks: 0 })]
  seen.set(`${start.x},${start.y},${start.z}`, q[0])
  while (q.length && seen.size < cap) {
    const n = q.shift()
    let nb = []
    try { nb = m.getNeighbors({ x: n.x, y: n.y, z: n.z, remainingBlocks: 0 }) } catch { continue }
    for (const mv of nb) {
      if (mv.toPlace?.length || mv.toBreak?.length) continue   // canDig=false, no scaffold
      const k = `${mv.x},${mv.y},${mv.z}`
      if (seen.has(k)) continue
      seen.set(k, mv)
      q.push(mv)
    }
  }
  return [...seen.values()]
}

/** mineflayer's canDigBlock geometry, verbatim (digging.js:220-226). */
export const inReach = (node, p) =>
  new Vec3(p.x, p.y, p.z).offset(0.5, 0.5, 0.5)
    .distanceTo(new Vec3(node.x + 0.5, node.y, node.z + 0.5).offset(0, 1.65, 0)) <= 5.1

/** gather's own `standable`: feet clear, head clear, solid underfoot. */
export const standable = (world, q) => {
  const pass = b => !b || b.name === 'air' || b.boundingBox === 'empty'
  const feet = world.getBlock(q), head = world.getBlock(q.offset(0, 1, 0)), under = world.getBlock(q.offset(0, -1, 0))
  return pass(feet) && pass(head) && !!under && under.boundingBox === 'block'
}

export function neighbourGoal (world, p) {
  const gs = []
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) {
    if (!dx && !dy && !dz) continue
    const q = new Vec3(p.x + dx, p.y + dy, p.z + dz)
    if (standable(world, q)) gs.push(new goals.GoalBlock(q.x, q.y, q.z))
  }
  return gs.length ? new goals.GoalCompositeAny(gs) : null
}

export { goals, Vec3, mcData }
