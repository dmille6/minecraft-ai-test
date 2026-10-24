// CAVEFALL-01: GATHER NEVER DIGS A FLOOR THAT HAS A HARMFUL DROP UNDER IT (docs/reports/cavefall-01-design-2026-10-24.md).
// Pure: no bot. `at(x, y, z)` reads a block (a prismarine Block, or {name, boundingBox, shapes?, props?}; null = unloaded).
//
// WHAT IT FIXES: a deterministic way to die that the code allows (96 fall-family deaths of 278 in 7 d to 10-24; gather was
// running in 44, in 10% of the bot-time). Its SHARE of them is not known: neither the world copies (a one-block floor hole
// above 13 of 67 cave landings, against 18% of matched control cells) nor the reach probe discriminated it (design §0.3).
// gather picks the nearest candidate, its reach goal accepts standing ON the block, `canDigBlock` reaches 4 down, and
// nothing between the candidate filter and bot.dig asks what is under the target (isSafeToBreak asks only about liquids
// beside it and falling blocks above). Prior art: Baritone never breaks the block it stands on without a walkable floor
// below it (MovementDownward; breakFromAbove off; its issue #3995 is this death); mineflayer-pathfinder #354 asks for the
// same guard and has none; Mindcraft's collectBlock has none.
//
// THE RULE, a property of the TARGET, not of where the bot happens to stand: a cell T is a FLOOR OVER A DROP when something
// can stand on it (the cell above is open, or holds a block that needs T to stay up: carpet, snow layer, rail...) and the
// fall from T's top, if T were gone, does damage. The fall is read in T's column and in every cardinal neighbour column
// that is open at T's level (a body standing on T overlaps them), and the WORST is taken. Damage: onto a solid floor
// ceil(d - 3) (vanilla's safe fall distance is 3); onto a stalagmite tip ceil(2 x (d - 1)) (PointedDripstoneBlock.fallOn:
// causeFallDamage(distance + 2, multiplier 2); minecraft.wiki gives floor(2d - 1), the same line within a point); into
// water 0 (swimming is travel); lava, an unloaded cell, or no floor within SCAN: not survivable. Such a T is never a gather
// target: digging it drops the bot if it stands there, and drops the ITEM into the cave if it does not, so neither the dig
// nor the walk to pick the item up can pay. A short drop onto rock -- the ordinary self-dig on a plain -- is untouched.

export const SAFE_DROP = 3      // vanilla: fall damage = ceil(distance - 3) onto a solid floor
export const SCAN = 32          // cells read below the target; no floor within them is `deep`
const EPS = 1e-6

/** CAVEFALL=0 turns the rule off (the one-setting rollback); anything else, or unset, leaves it on. */
export const cavefallOn = (env = typeof process !== 'undefined' ? process.env : {}) => String(env?.CAVEFALL ?? '1') !== '0'

const LAVA = /^(lava|flowing_lava|magma_block)$/
const WATER = /^(water|flowing_water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/
/** Blocks that need the block under them and pop when it goes: standing on one is standing on the cell below. */
export const NEEDS_SUPPORT = /(^|_)carpet$|^snow$|_pressure_plate$|^(rail|powered_rail|detector_rail|activator_rail|redstone_wire|repeater|comparator|lily_pad)$/

const propsOf = b => {
  try { if (typeof b?.getProperties === 'function') return b.getProperties() ?? {} } catch { /* fall through */ }
  return b?.props ?? {}
}
const shapesOf = b => Array.isArray(b?.shapes) ? b.shapes : (b?.boundingBox === 'block' ? [[0, 0, 0, 1, 1, 1]] : [])

/** What a cell is for a body falling onto it. Unloaded is 'unknown' (never open). A stalagmite is a TIP pointing UP. */
export function cellKind (b) {
  if (b == null) return 'unknown'
  const n = String(b.name ?? '')
  if (LAVA.test(n)) return 'lava'
  if (WATER.test(n)) return 'water'
  if (n === 'pointed_dripstone') {
    const p = propsOf(b)
    const up = p.vertical_direction == null || String(p.vertical_direction) === 'up'
    const tip = p.thickness == null || String(p.thickness) === 'tip'
    return up && tip ? 'stalagmite' : 'solid'
  }
  return shapesOf(b).length ? 'solid' : 'open'
}

/** The footprint (cell-local x and z ranges) a 0.6-wide body standing on T can occupy in a column. */
const CENTRED = { x: [0.2, 0.8], z: [0.2, 0.8] }
/** A body straddling from T toward the neighbour (dx, dz): its part over T's column, and its part over the neighbour's. */
const straddle = (dx, dz) => ({
  t: { x: dx > 0 ? [0.4, 1] : dx < 0 ? [0, 0.6] : CENTRED.x, z: dz > 0 ? [0.4, 1] : dz < 0 ? [0, 0.6] : CENTRED.z },
  n: { x: dx > 0 ? [0, 0.3] : dx < 0 ? [0.7, 1] : CENTRED.x, z: dz > 0 ? [0, 0.3] : dz < 0 ? [0.7, 1] : CENTRED.z },
})
/** Highest top (block units above the cell's y) of the shapes that overlap the footprint, or null: a partial shape (an open
 * trapdoor, a wall-mounted ladder) that the body misses is not a floor (Codex r2 P1). */
const topIn = (b, fp) => {
  let top = null
  for (const s of shapesOf(b)) {
    if (s[0] < fp.x[1] && s[3] > fp.x[0] && s[2] < fp.z[1] && s[5] > fp.z[0]) top = top == null ? s[4] : Math.max(top, s[4])
  }
  return top
}
const KIND_RANK = { water: 0, solid: 1, stalagmite: 2, lava: 3, unknown: 4, deep: 5 }

/** The first thing a body falling in ONE column meets, from `fromY` down, within the footprint: {top, kind}. Pure. */
function columnStop (at, x, z, fromY, fp, scan) {
  for (let y = fromY; y >= fromY - scan; y--) {
    let b
    try { b = at(x, y, z) } catch { b = null }
    const k = cellKind(b)
    if (k === 'water' || k === 'lava' || k === 'unknown') return { top: y + 1, kind: k }
    if (k === 'open') continue
    const top = topIn(b, fp)
    if (top != null) return { top: y + top, kind: k }
  }
  return { top: -Infinity, kind: 'deep' }
}

/** Fall damage (half-hearts) for a drop onto a landing kind. Infinity where the landing itself kills or is unknown. */
export function fallDamage (drop, landing) {
  if (landing === 'water') return 0
  if (landing === 'solid') return Math.max(0, Math.ceil(drop - SAFE_DROP - EPS))
  if (landing === 'stalagmite') return Math.max(0, Math.ceil(2 * (drop - 1) - EPS))
  return Infinity                                            // lava, unknown, deep
}

/** Can something stand on T: the cell above is open, or holds a block that needs T. */
export function standable (at, t) {
  let a
  try { a = at(t.x, t.y + 1, t.z) } catch { a = null }
  if (a == null) return true                                 // unloaded above: assume a body could be there
  const k = cellKind(a)
  if (k === 'open' || NEEDS_SUPPORT.test(String(a.name ?? ''))) return true
  // a partial shape the body does not meet (an open trapdoor, a ladder on the wall) leaves room to stand on T (Codex r2 P1)
  return k === 'solid' && topIn(a, CENTRED) == null
}

/**
 * The fall a body standing on T would take if T were gone. A falling body stops at the FIRST thing any part of it meets, so
 * each placement of the body is one scenario: centred on T (T's column only), or straddling toward each cardinal neighbour
 * that is open at T's level (T's column and that one; the higher stop wins). The WORST scenario is the verdict
 * {drop, landing, damage, col}. A neighbour that is solid at T's level holds a straddling body up; an unloaded one is not
 * known to be open, so T's own column decides. Pure; never throws.
 */
export function dropIfRemoved (at, t, { scan = SCAN } = {}) {
  const feetY = t.y + 1
  const verdict = (stops, col) => {
    const st = stops.reduce((a, b) => (b.top > a.top || (b.top === a.top && KIND_RANK[b.kind] > KIND_RANK[a.kind])) ? b : a)
    const drop = st.kind === 'deep' ? scan + 1 : Math.max(0, feetY - st.top)
    return { drop, landing: st.kind, damage: fallDamage(drop, st.kind), col }
  }
  let worst = verdict([columnStop(at, t.x, t.z, t.y - 1, CENTRED, scan)], [0, 0])
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let b
    try { b = at(t.x + dx, t.y, t.z + dz) } catch { b = null }
    if (cellKind(b) !== 'open') continue
    const fp = straddle(dx, dz)
    const v = verdict([columnStop(at, t.x, t.z, t.y - 1, fp.t, scan), columnStop(at, t.x + dx, t.z + dz, t.y, fp.n, scan)], [dx, dz])
    if (v.damage > worst.damage) worst = v
  }
  return worst
}

/**
 * The verdict on a gather target T. Never throws.
 *   {skip: false, why}                  not a floor, or the fall does no damage: an ordinary target
 *   {skip: true, drop, landing, damage} a floor over a harmful drop: not a target
 */
export function floorOverDrop ({ target, at }) {
  try {
    if (!target || ![target.x, target.y, target.z].every(Number.isFinite)) return { skip: false, why: 'no target' }
    const t = { x: Math.floor(target.x), y: Math.floor(target.y), z: Math.floor(target.z) }
    let b
    try { b = at(t.x, t.y, t.z) } catch { b = null }
    const k = cellKind(b)
    if (k !== 'solid' && k !== 'stalagmite') return { skip: false, why: 'not solid' }
    if (!standable(at, t)) return { skip: false, why: 'nothing can stand on it' }
    const f = dropIfRemoved(at, t)
    return f.damage >= 1 ? { skip: true, drop: f.drop, landing: f.landing, damage: f.damage, col: f.col }
      : { skip: false, why: 'the fall is harmless', drop: f.drop, landing: f.landing, damage: f.damage }
  } catch (e) { return { skip: false, why: `verdict failed: ${String(e?.message ?? e).slice(0, 60)}` } }
}

/** Is T one of the support cells under a 0.6-wide body at `pos` (for the `_cavefall_floor allowed` row only). Pure. */
export function underFeet (pos, t) {
  if (!pos || !t) return false
  const sy = Math.ceil(pos.y - EPS) - 1
  const xs = new Set([Math.floor(pos.x - 0.3), Math.floor(pos.x + 0.3 - EPS)])
  const zs = new Set([Math.floor(pos.z - 0.3), Math.floor(pos.z + 0.3 - EPS)])
  return Math.floor(t.y) === sy && xs.has(Math.floor(t.x)) && zs.has(Math.floor(t.z))
}

const dmg = d => d === Infinity ? 'inf' : d

/** One line for a `_cavefall_floor` row, evidence first. Pure. */
export function describeFloor ({ decision, target, name, verdict }) {
  const v = verdict ?? {}
  return `${decision}: ${name ?? '?'} at ${target.x},${target.y},${target.z}; drop ${v.drop == null ? '?' : +(+v.drop).toFixed(2)} onto ${v.landing ?? '?'} ` +
    `(damage ${dmg(v.damage) ?? '?'}${v.col && (v.col[0] || v.col[1]) ? `, via the neighbour column ${v.col.join(',')}` : ''})`
}

/** The dig-time refusal: the remedy first, so gather's 120-character error note keeps it; worded for any caller (gather,
 * craft's table retake). Pure. */
export function floorRefusal ({ name, target, verdict }) {
  const v = verdict ?? {}
  return `floor_dig: dig elsewhere -- ${name} at ${target.x},${target.y},${target.z} is a floor over a ` +
    `${v.landing === 'deep' ? `${SCAN}+-block drop` : `${+(+v.drop).toFixed(2)}-block drop onto ${v.landing}`}`
}

/** The `_cavefall_skip` row: how many of the round's candidates were skipped, split by which column decided (T's own, or a
 * neighbour a straddling body would meet first), with the landing kinds -- so the read can see over-refusal. Pure. */
export function skipDetail ({ name, verdicts = [], considered = 0 }) {
  const own = verdicts.filter(v => !v.col || (!v.col[0] && !v.col[1])).length
  const kinds = Object.entries(verdicts.reduce((a, v) => { a[v.landing] = (a[v.landing] ?? 0) + 1; return a }, {})).map(([k, n]) => `${k}:${n}`).join(',')
  return `${name}: ${verdicts.length} of ${considered} candidate(s) are floors over a harmful drop; skipped own=${own} nbr=${verdicts.length - own} land=${kinds || '-'}`
}

/** gather's message when every safe candidate in range is a floor over a drop. Remedy first. Pure. */
export function allFloorsMessage ({ name, n, verdicts = [] }) {
  const lands = [...new Set(verdicts.map(v => v.landing).filter(Boolean))].slice(0, 3).join('/')
  return `${name} found but all ${n} candidate(s) are floors over a drop into a cave${lands ? ` (onto ${lands})` : ''} -- ` +
    `digging one drops you or the item; gather ${name} elsewhere, or explore`
}

/** The licence row's detail (`_cavefall_mode`, once per spawn). */
export const cavefallModeDetail = (env = typeof process !== 'undefined' ? process.env : {}) =>
  `on=${cavefallOn(env) ? 1 : 0} rule=floor_over_drop safe_drop=${SAFE_DROP} scan=${SCAN} stalagmite=2(d-1) water=allow lava=skip unknown=skip`
