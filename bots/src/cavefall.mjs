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

/** The centred body's footprint in T's column (cell-local x and z ranges). */
const CENTRED = { x: [0.2, 0.8], z: [0.2, 0.8] }
/** Highest top (block units above the cell's y) of the shapes that overlap the footprint, or null: a partial shape (an open
 * trapdoor, a wall-mounted ladder, a fence post) that the body misses is not a floor (Codex r2 P1). */
const topIn = (b, fp) => {
  let top = null
  for (const s of shapesOf(b)) {
    if (s[0] < fp.x[1] && s[3] > fp.x[0] && s[2] < fp.z[1] && s[5] > fp.z[0]) top = top == null ? s[4] : Math.max(top, s[4])
  }
  return top
}
/** A solid whose shapes fill the whole cell (dirt, stone): the fast path's test. */
const fullCube = b => cellKind(b) === 'solid' && shapesOf(b).some(s => s[0] <= 0 && s[2] <= 0 && s[3] >= 1 && s[5] >= 1 && s[1] <= 0 && s[4] >= 1)
/** Does a shape of `b` (cell at height cy) overlap the footprint AND the vertical span (lo, hi)? */
const meets = (b, cy, fp, lo, hi) => shapesOf(b).some(s => s[0] < fp.x[1] && s[3] > fp.x[0] && s[2] < fp.z[1] && s[5] > fp.z[0] && cy + s[1] < hi && cy + s[4] > lo)
/** On an exact tie between two stops, a body resting on a solid top is held by it (Claude r4 P3-3: a fluid or unloaded cell
 * whose top only reaches the same height does not out-rank the cube that catches the body); between solids, the tip is worse. */
const KIND_RANK = { water: 0, lava: 1, unknown: 2, deep: 3, solid: 4, stalagmite: 5 }
const HALF = 0.3, BODY_H = 1.8
/** Body-centre positions (cell-local) tried over T: every placement whose 0.6-wide box overlaps T's column, edges included
 * (Codex r3 P1: a body at x 0.97 misses a fence post that every centred-or-half-straddle footprint met). */
export const PLACEMENTS = [-0.28, -0.12, 0.03, 0.19, 0.34, 0.5, 0.66, 0.81, 0.97, 1.12, 1.28]

/** Fall damage (half-hearts) for a drop onto a landing kind. Infinity where the landing itself kills or is unknown. */
export function fallDamage (drop, landing) {
  if (landing === 'water') return 0
  if (landing === 'solid') return Math.max(0, Math.ceil(drop - SAFE_DROP - EPS))
  if (landing === 'stalagmite') return Math.max(0, Math.ceil(2 * (drop - 1) - EPS))
  return Infinity                                            // lava, unknown, deep
}

/** Can a centred body stand on T: the cell above is open, holds a block that needs T, or a partial shape it does not meet. */
export function standable (at, t) {
  let a
  try { a = at(t.x, t.y + 1, t.z) } catch { a = null }
  if (a == null) return true                                 // unloaded above: assume a body could be there
  const k = cellKind(a)
  if (k === 'open' || NEEDS_SUPPORT.test(String(a.name ?? ''))) return true
  return k === 'solid' && topIn(a, CENTRED) == null
}

/**
 * The fall a body standing on T would take if T were gone. Every placement of the 0.6-wide body whose box rests on T is
 * tried (PLACEMENTS x PLACEMENTS, edges included). For each one: the feet are at T's real top within the box (a fence 1.5, a
 * slab 0.5; a carpet or snow layer on T counts as T's and goes with it); a placement whose box meets a solid in its own
 * volume is impossible, and one that another cell also holds up does not fall; otherwise the body falls in every column its
 * box covers and stops at the FIRST thing any part of it meets (the highest stop; water, lava and an unloaded cell stop it
 * too). The WORST placement is the verdict {drop, landing, damage, col, standing}; `standing` 0 means no body can stand on T.
 * Pure; never throws.
 */
export function dropIfRemoved (at, t, { scan = SCAN } = {}) {
  const cache = new Map()
  const get = (x, y, z) => { const k = `${x},${y},${z}`; if (!cache.has(k)) { let b; try { b = at(x, y, z) } catch { b = null } cache.set(k, b) } return cache.get(k) }
  const tb = get(t.x, t.y, t.z)
  const above = get(t.x, t.y + 1, t.z)
  const carried = above && NEEDS_SUPPORT.test(String(above.name ?? '')) ? above : null   // goes with T
  let worst = { drop: 0, landing: 'solid', damage: 0, col: [0, 0] }
  let standing = 0
  for (const cx of PLACEMENTS) {
    for (const cz of PLACEMENTS) {
      const box = { x: [cx - HALF, cx + HALF], z: [cz - HALF, cz + HALF] }
      const cols = []
      for (const dx of [-1, 0, 1]) {
        for (const dz of [-1, 0, 1]) {
          const ix = [Math.max(box.x[0], dx), Math.min(box.x[1], dx + 1)], iz = [Math.max(box.z[0], dz), Math.min(box.z[1], dz + 1)]
          if (ix[1] - ix[0] > EPS && iz[1] - iz[0] > EPS) cols.push({ dx, dz, fp: { x: [ix[0] - dx, ix[1] - dx], z: [iz[0] - dz, iz[1] - dz] } })
        }
      }
      const own = cols.find(c => !c.dx && !c.dz)
      if (!own) continue
      const tTop = topIn(tb, own.fp)
      if (tTop == null) continue                                                        // the box is not over T's shape
      const cTop = carried ? topIn(carried, own.fp) : null
      const feet = cTop != null ? t.y + 1 + cTop : t.y + tTop
      // impossible: a solid (not T, not what T carries) inside the body's own volume
      let blocked = false, held = false
      for (const c of cols) {
        for (let y = Math.floor(feet - 0.5); y <= Math.floor(feet + BODY_H); y++) {
          if (!c.dx && !c.dz && (y === t.y || (carried && y === t.y + 1))) continue
          const b = get(t.x + c.dx, y, t.z + c.dz)
          if (b == null) continue
          if (meets(b, y, c.fp, feet + 0.01, feet + BODY_H)) blocked = true
          else if (!(!c.dx && !c.dz)) { const top = topIn(b, c.fp); if (top != null && Math.abs(y + top - feet) <= 0.01) held = true }
        }
      }
      if (blocked) continue
      standing++
      if (held) continue                                                                 // another cell holds it up
      // the fall: every covered column, from just under the feet down; the highest stop wins
      let stop = { top: -Infinity, kind: 'deep', col: [0, 0] }
      for (const c of cols) {
        for (let y = Math.floor(feet - EPS); y >= Math.floor(feet) - 1 - scan; y--) {
          if (!c.dx && !c.dz && (y === t.y || (carried && y === t.y + 1))) continue    // T (and what it carries) are gone
          const b = get(t.x + c.dx, y, t.z + c.dz)
          const k = cellKind(b)
          let top = null
          if (k === 'water' || k === 'lava' || k === 'unknown') top = Math.min(y + 1, feet)
          else if (k !== 'open') { const tp = topIn(b, c.fp); if (tp != null && y + tp <= feet + 0.01) top = y + tp }
          if (top == null) continue
          if (top > stop.top || (top === stop.top && KIND_RANK[k] > KIND_RANK[stop.kind])) stop = { top, kind: k, col: [c.dx, c.dz] }
          break
        }
      }
      const drop = stop.kind === 'deep' ? scan + 1 : Math.max(0, feet - stop.top)
      const v = { drop: +drop.toFixed(4), landing: stop.kind, damage: fallDamage(drop, stop.kind), col: stop.col }
      if (v.damage > worst.damage || (v.damage === worst.damage && v.drop > worst.drop)) worst = v
    }
  }
  return { ...worst, standing }
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
    // THE FAST PATH (gather asks this of every candidate cell in range at enumeration, most of them buried), each step exact
    // for the full verdict (Codex r4 P2-2: a full cube under T alone is NOT enough -- a body straddling an open neighbour can
    // meet lava there first):
    //   - a full cube directly OVER T: every placement's box meets it inside the body's volume, so no body stands on T;
    //   - T a full cube with a full cube UNDER it and full cubes on all four cardinal sides at T's level: a placement over T
    //     alone stops on the cube under T (a 1-block drop), and every other placement also rests on a cardinal cube (a box
    //     reaching a diagonal column reaches both cardinals beside it), so none falls further.
    const rd = (x, y, z) => { try { return at(x, y, z) } catch { return null } }
    if (fullCube(rd(t.x, t.y + 1, t.z))) return { skip: false, why: 'nothing can stand on it' }
    //     Not when T carries a carpet, snow layer or the like: the feet are then above the cardinal cubes' tops (Codex r5 P2-1)
    const over = rd(t.x, t.y + 1, t.z)
    const carries = over && NEEDS_SUPPORT.test(String(over.name ?? ''))
    if (!carries && fullCube(b) && fullCube(rd(t.x, t.y - 1, t.z)) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => fullCube(rd(t.x + dx, t.y, t.z + dz)))) {
      return { skip: false, why: 'solid under and around it', drop: 1, landing: 'solid', damage: 0 }
    }
    const f = dropIfRemoved(at, t)
    if (!f.standing) return { skip: false, why: 'nothing can stand on it' }
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
export function skipDetail ({ name, verdicts = [], considered = 0, front = 0 }) {
  const own = verdicts.filter(v => !v.col || (!v.col[0] && !v.col[1])).length
  const kinds = Object.entries(verdicts.reduce((a, v) => { a[v.landing] = (a[v.landing] ?? 0) + 1; return a }, {})).map(([k, n]) => `${k}:${n}`).join(',')
  return `${name}: ${verdicts.length} of ${considered} candidate(s) are floors over a harmful drop; skipped own=${own} nbr=${verdicts.length - own} land=${kinds || '-'} front=${front ? 1 : 0}`
}

/** Was the round's nearest skipped floor nearer the bot than the nearest kept candidate -- would the base have picked a skipped
 * one first? (The read's exposure; Claude r3 P2-2.) `pos` the bot's position, `skipped` cells, `kept` cells. Pure. */
export function frontSkipped (pos, skipped = [], kept = []) {
  if (!pos || !skipped.length) return false
  const d = c => Math.hypot(c.x + 0.5 - pos.x, c.y + 0.5 - (pos.y + 1.62), c.z + 0.5 - pos.z)
  const ns = Math.min(...skipped.map(d)), nk = kept.length ? Math.min(...kept.map(d)) : Infinity
  return ns < nk
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
