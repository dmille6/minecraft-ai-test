// CAVEFALL-01: NEVER DIG THE BLOCK YOU STAND ON OVER A HARMFUL DROP (docs/reports/cavefall-01-design-2026-10-24.md).
// Pure: no bot. `at(x, y, z)` reads a block ({name, boundingBox} or null for an unloaded cell); positions are numbers.
//
// THE MECHANISM, measured 7 d to 10-24 (96 fall/dripstone deaths of 278): 75 of 91 with a path record had a planned path
// with NO drop, so the planner did not plan the fall; 61 of 84 landed within 1.5 blocks of the last position logged above
// the landing (a vertical fall, not a walk off an edge); a block on the bot's own path changed in the 6 s before the
// descent in 38% of them against 13% at other times for the same bots. gather picks the NEAREST candidate and its reach
// goal accepts standing ON the block, so on a dirt shelf over a cave the first target is the shelf cell under the feet,
// and nothing between the candidate filter and bot.dig asks what is beneath it (isSafeToBreak asks only about liquids and
// falling blocks above). Prior art: Baritone never breaks the block it stands on unless the cell below is walkable
// (MovementDownward; breakFromAbove off by default; issue #3995 is this exact death), mineflayer-pathfinder #354 asks for
// the same guard and has none, Mindcraft's collectBlock has none.
//
// THE RULE. A dig of T is a FLOOR DIG when T is a solid cell of the bot's support layer that its 0.6-wide box overlaps and
// no OTHER solid support cell remains. A floor dig is allowed only when the fall it causes does no damage: a solid landing
// within SAFE_DROP blocks (vanilla fall damage is distance - 3), or a water landing at any depth (swimming is travel).
// A stalagmite landing doubles the damage (minecraft.wiki: floor(2 x distance - 1)); lava, an unloaded cell and no floor
// within SCAN are refused. A refused floor dig is not a refused gather: the caller first steps to a stance BESIDE the
// target (sideStances), from where the same dig is not a floor dig, and only when there is none does it skip the
// candidate, naming the remedy.

export const SAFE_DROP = 3      // vanilla: fall damage = distance - 3, so a drop of 3 onto a solid floor costs nothing
export const SCAN = 32          // cells read below the target; no floor within them is `deep` and refused
const HALF = 0.3                // the player's half-width
const EPS = 1e-6

/** CAVEFALL=0 turns the guard off (the one-setting rollback); anything else, or unset, leaves it on. */
export const cavefallOn = (env = typeof process !== 'undefined' ? process.env : {}) => String(env?.CAVEFALL ?? '1') !== '0'

const LAVA = /^(lava|flowing_lava)$/
const WATER = /^(water|flowing_water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/

/** What a cell is, for a body falling into it. 'unknown' for an unloaded cell (never assumed open). */
export function cellKind (b) {
  if (b == null) return 'unknown'
  const n = String(b.name ?? '')
  if (LAVA.test(n)) return 'lava'
  if (WATER.test(n) || b.waterlogged === true) return 'water'
  if (n === 'pointed_dripstone') return 'stalagmite'
  if (b.boundingBox === 'block') return 'solid'
  return 'open'
}

/** The support layer's y under a body whose feet are at `y` (feet 31.0 stands on y=30; feet 31.5 on a slab at y=31). */
export const supportY = y => Math.ceil(y - EPS) - 1

/** The support-layer cells the body's box overlaps: 1, 2 or 4 cells. */
export function supportCells (pos) {
  const sy = supportY(pos.y)
  const xs = [...new Set([Math.floor(pos.x - HALF), Math.floor(pos.x + HALF - EPS)])]
  const zs = [...new Set([Math.floor(pos.z - HALF), Math.floor(pos.z + HALF - EPS)])]
  const out = []
  for (const x of xs) for (const z of zs) out.push({ x, y: sy, z })
  return out
}

/** The fall from T's top if T is removed: {drop, landing, landY}. drop = blocks fallen (feet T.y+1 -> landY+1). */
export function dropBelow (at, t, { scan = SCAN } = {}) {
  for (let y = t.y - 1; y >= t.y - scan; y--) {
    let b
    try { b = at(t.x, y, t.z) } catch { b = null }
    const k = cellKind(b)
    if (k === 'open') continue
    if (k === 'water') return { drop: t.y - y, landing: 'water', landY: y }
    return { drop: t.y - y, landing: k, landY: y }            // solid, stalagmite, lava, unknown
  }
  return { drop: scan + 1, landing: 'deep', landY: null }
}

/** Fall damage (half-hearts) for a drop onto a landing kind. Infinity where the landing itself is the danger or unknown. */
export function fallDamage (drop, landing) {
  if (landing === 'water') return 0
  if (landing === 'solid') return Math.max(0, drop - SAFE_DROP)
  if (landing === 'stalagmite') return drop <= 0 ? 0 : Math.max(0, Math.floor(2 * drop - 1))
  return Infinity                                            // lava, unknown, deep
}

const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z

/**
 * The verdict on digging cell T for a body at `pos`. Never throws.
 *   {floor: false}                     not a floor dig (T is not under the box, or another solid support remains): dig
 *   {floor: true, allow: true, ...}    a floor dig whose fall does no damage (a short drop, or water): dig
 *   {floor: true, allow: false, ...}   a floor dig over a harmful fall: step beside it first (sideStances), else skip it
 */
export function floorDigVerdict ({ pos, target, at }) {
  try {
    if (!pos || !target || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return { floor: false, why: 'no position' }
    const t = { x: Math.floor(target.x), y: Math.floor(target.y), z: Math.floor(target.z) }
    const cells = supportCells(pos)
    if (!cells.some(c => same(c, t))) return { floor: false, why: 'not under the feet' }
    const solid = c => { let b; try { b = at(c.x, c.y, c.z) } catch { b = null } const k = cellKind(b); return k === 'solid' || k === 'stalagmite' }
    if (!solid(t)) return { floor: false, why: 'the target is not solid' }
    const others = cells.filter(c => !same(c, t) && solid(c)).length
    if (others > 0) return { floor: false, why: `${others} other support cell(s) remain`, others }
    const d = dropBelow(at, t)
    const damage = fallDamage(d.drop, d.landing)
    return { floor: true, allow: damage < 1, drop: d.drop, landing: d.landing, landY: d.landY, damage }
  } catch (e) { return { floor: false, why: `verdict failed: ${String(e?.message ?? e).slice(0, 60)}` } }
}

const passable = b => { const k = cellKind(b); return k === 'open' }

/**
 * Stances BESIDE the target from which digging it is not a floor dig: the 8 cells around the body's feet cell at feet
 * height, cardinals first, then diagonals; each has open feet and head, a solid floor that is not T, not a stalagmite and
 * not lava, and T's centre within `reach` of the stance's eye. Deterministic order.
 */
export function sideStances ({ pos, target, at, reach = 4.5 }) {
  const t = { x: Math.floor(target.x), y: Math.floor(target.y), z: Math.floor(target.z) }
  const fy = supportY(pos.y) + 1
  const fx = Math.floor(pos.x), fz = Math.floor(pos.z)
  const rd = (x, y, z) => { try { return at(x, y, z) } catch { return null } }
  const out = []
  const order = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  for (const [dx, dz] of order) {
    const s = { x: fx + dx, y: fy, z: fz + dz }
    if (same({ x: s.x, y: s.y - 1, z: s.z }, t)) continue
    if (!passable(rd(s.x, s.y, s.z)) || !passable(rd(s.x, s.y + 1, s.z))) continue
    if (cellKind(rd(s.x, s.y - 1, s.z)) !== 'solid') continue
    // a diagonal step must not cut a corner through a wall (both orthogonal neighbours at feet and head open)
    if (dx && dz) {
      const ok = [[dx, 0], [0, dz]].some(([ax, az]) => passable(rd(fx + ax, fy, fz + az)) && passable(rd(fx + ax, fy + 1, fz + az)))
      if (!ok) continue
    }
    const ex = s.x + 0.5 - (t.x + 0.5), ey = s.y + 1.62 - (t.y + 0.5), ez = s.z + 0.5 - (t.z + 0.5)
    if (Math.hypot(ex, ey, ez) > reach) continue
    out.push(s)
  }
  return out
}

/** One line for the `_cavefall_floor` row, evidence first. Pure. */
export function describeFloor ({ decision, target, name, verdict, stance = null, why = null }) {
  const v = verdict ?? {}
  return `${decision}: ${name ?? '?'} at ${target.x},${target.y},${target.z} is the floor under the bot; ` +
    `drop ${v.drop ?? '?'} onto ${v.landing ?? '?'} (damage ${v.damage === Infinity ? 'inf' : v.damage ?? '?'})` +
    `${stance ? `; stance ${stance.x},${stance.y},${stance.z}` : ''}${why ? `; ${why}` : ''}`
}

/** The licence row's detail (`_cavefall_mode`, once per spawn). */
export const cavefallModeDetail = (env = typeof process !== 'undefined' ? process.env : {}) =>
  `on=${cavefallOn(env) ? 1 : 0} safe_drop=${SAFE_DROP} scan=${SCAN} stalagmite=2x water=allow lava=refuse unknown=refuse remedy=step_beside`

/** The refusal's message, naming what the bot can do from where it stands. Pure. */
export function floorRefusal ({ name, target, verdict, tried = 0 }) {
  const v = verdict ?? {}
  return `floor_dig: ${name} at ${target.x},${target.y},${target.z} is the only block under the bot and below it is a ` +
    `${v.landing === 'deep' ? `drop of more than ${SCAN}` : `${v.drop}-block drop onto ${v.landing}`}; ` +
    `${tried ? `no stance beside it could be reached (${tried} tried)` : 'there is no stance beside it to dig it from'} -- ` +
    `walk off it onto solid ground first (goto a cell beside it), or gather ${name} somewhere else`
}
