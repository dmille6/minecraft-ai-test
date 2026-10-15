// THE SHARED MINESHAFT'S GEOMETRY AND SURVEY (docs/reports/ziggurat-mineshaft-2026-10-15.md section 4). PURE. The
// offline gate (scripts/zigsite.mjs, M0) and, later, the dig_shaft job use the SAME envelope, so the column the gate
// surveyed is the column the builder opens.
//
// Shaft-local frame: core cells (0,y,0) and (1,y,0); +z points AWAY from home; ladders hang on the x=-1 wall (column 0,
// DOWN) and the x=2 wall (column 1, UP). Collar c = the site's ground level + 1 (feet level); top ladders at c-1.
// Landings every 8 levels at yL = c - 8k while yL >= SHAFT_FLOOR, plus a terminal landing at the bottom when that is more
// than 3 below the last one. Each landing: a 2-wide x 2-high portal at z=1, a room x -1..2 / z 2..4 / 2 high, a stub
// x 0..1 / z 5..8 / 2 high whose end face (z=9) is NOT part of the envelope (digging continues there).
import { solid, isLiquid } from './blueprint.mjs'

export const SHAFT_FLOOR = 16
export const LANDING_EVERY = 8
export const SHAFT_RING = Object.freeze({ min: 17, max: 21 })
/** Liquid, a bubble column, or any waterlogged block (a waterlogged slab or leaf opened is water). Pure. */
export const wet = b => !!b && (isLiquid(b) || b.name === 'bubble_column' || b.name === 'kelp' || b.name === 'kelp_plant' || b.name === 'seagrass' || b.name === 'tall_seagrass' || b.props?.waterlogged === true || b.props?.waterlogged === 'true')
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|.*concrete_powder|pointed_dripstone)$/

/** Local (u, v) -> world (x, z) for an orientation: away = 'n'|'s'|'e'|'w' (the +v direction). */
export function toWorld (origin, away, u, v) {
  switch (away) {
    case 's': return { x: origin.x + u, z: origin.z + v }
    case 'n': return { x: origin.x - u, z: origin.z - v }
    case 'e': return { x: origin.x + v, z: origin.z - u }
    case 'w': return { x: origin.x - v, z: origin.z + u }
  }
  throw new Error(`bad orientation ${away}`)
}

/** The landing levels for a collar c and a bottom limit. Pure. */
export function landingLevels (c, floor = SHAFT_FLOOR) {
  const out = []
  for (let y = c - LANDING_EVERY; y >= floor; y -= LANDING_EVERY) out.push(y)
  const last = out.length ? out[out.length - 1] : c
  if (last - floor > 3) out.push(floor)
  return out
}

/**
 * THE ENVELOPE, per level, in local coords -> { dig: [[u,y,v,role]], shell: [[u,y,v]] }. dig = cells opened (core,
 * portal, room, stub); shell = every 6-neighbour of a dig cell that is not itself dug (the lining that must be solid).
 * The stub's end face (v = 9) and below-the-stub-end cells are excluded from the shell: digging continues there.
 */
export function envelopeLevels (c, bottom, landings) {
  const L = new Set(landings), dig = new Map()
  const add = (u, y, v, role) => dig.set(`${u},${y},${v}`, [u, y, v, role])
  for (let y = c; y >= bottom; y--) { add(0, y, 0, 'core'); add(1, y, 0, 'core') }
  for (const yL of L) {
    for (const y of [yL, yL + 1]) {
      add(0, y, 1, 'portal'); add(1, y, 1, 'portal')
      for (let u = -1; u <= 2; u++) for (let v = 2; v <= 4; v++) add(u, y, v, 'room')
      for (let u = 0; u <= 1; u++) for (let v = 5; v <= 8; v++) add(u, y, v, 'stub')
    }
  }
  const shell = new Map()
  for (const [u, y, v] of dig.values()) {
    for (const [du, dy, dv] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const k = `${u + du},${y + dy},${v + dv}`
      if (dig.has(k)) continue
      if (y + dy > c) continue                       // above the collar is open air by design
      if (y + dy === c && v + dv === -1 && (u + du === 0 || u + du === 1)) continue   // the ENTRY PAD stays open (Claude stage-1 P2)
      if (v + dv === 9 && L.has(y) ) continue         // the stub's end face: digging continues there
      if (v + dv === 9 && L.has(y - 1)) continue
      shell.set(k, [u + du, y + dy, v + dv])
    }
  }
  // THE STUB END FACE AND THE FIRST TREAD BELOW IT are not lining (digging continues there) but they ARE surveyed for
  // liquid (Codex stage-1 P1: water at the end face passed the survey and would have opened onto the stub).
  const face = []
  for (const yL of L) for (let y = yL - 1; y <= yL + 1; y++) for (let u = 0; u <= 1; u++) face.push([u, y, 9])
  return { dig: [...dig.values()], shell: [...shell.values()], face }
}

/** THE COLLAR SITS AT THE TOWN'S SURFACE LEVEL (never in a dug-out pit, never on a pillar). Pure. */
export const COLLAR_TOLERANCE = 6
export const collarOk = (groundTop, homeY, tol = COLLAR_TOLERANCE) => Number.isFinite(groundTop) && Math.abs(groundTop + 1 - homeY) <= tol

/**
 * SURVEY ONE COLUMN, top down, one level at a time (the build's own order) -> { bottom, landings, digs, lining,
 * falling, liquidStop, ores, unknown }. A level whose shell or dig cells hold a liquid, or whose shell holds an unknown
 * (unread) cell, stops the shaft ABOVE it: bottom = the deepest landing (or the core floor) above the stop.
 * read(x,y,z) over world coords; origin = {x, z} of local (0,0); c = collar (feet) level.
 */
export function surveyShaft ({ read, origin, away, c, floor = SHAFT_FLOOR }) {
  const landingsAll = landingLevels(c, floor)
  const env = envelopeLevels(c, floor, landingsAll)
  const at = (u, y, v) => { const w = toWorld(origin, away, u, v); return read(w.x, y, w.z) }
  // stop level: the highest y at which any dig or shell cell at y is liquid/unknown
  let stop = null
  const byY = new Map()
  for (const [u, y, v] of env.dig) { if (!byY.has(y)) byY.set(y, []); byY.get(y).push(['dig', u, v]) }
  for (const [u, y, v] of env.shell) { if (!byY.has(y)) byY.set(y, []); byY.get(y).push(['shell', u, v]) }
  for (const [u, y, v] of env.face) { if (!byY.has(y)) byY.set(y, []); byY.get(y).push(['face', u, v]) }
  const ys = [...byY.keys()].sort((a, b) => b - a)
  let unknown = 0
  for (const y of ys) {
    for (const [, u, v] of byY.get(y)) {
      const b = at(u, y, v)
      if (!b) { unknown++; stop = stop ?? y; break }
      if (wet(b)) { stop = stop ?? y; break }
    }
    if (stop != null) break
  }
  const landings = landingsAll.filter(yL => stop == null || yL - 2 > stop)   // the landing and its floor/ceiling shell clear the stop
  const bottom = landings.length ? landings[landings.length - 1] : null
  if (bottom == null) return { bottom: null, landings, stop, why: stop != null ? `liquid/unknown at y=${stop} before the first landing` : 'no landing', unknown }
  const env2 = envelopeLevels(c, bottom, landings)
  let digs = 0, lining = 0, falling = 0, ores = 0
  for (const [u, y, v] of env2.dig) { const b = at(u, y, v); if (b && solid(b)) digs++; if (b && /_ore$/.test(b.name)) ores++; if (b && FALLING.test(b.name)) falling++ }
  for (const [u, y, v] of env2.shell) { const b = at(u, y, v); if (!b || !solid(b) || FALLING.test(b.name)) lining++; if (b && FALLING.test(b.name)) falling++ }
  return { bottom, landings, stop, digs, lining, falling, ores, unknown, levels: c - bottom + 1 }
}

/** Collar candidates: origins on the ring around home, each with the orientation pointing away from home. Pure. */
export function collarCandidates (home, { ring = SHAFT_RING } = {}) {
  const out = []
  for (let dx = -ring.max; dx <= ring.max; dx++) for (let dz = -ring.max; dz <= ring.max; dz++) {
    const d = Math.max(Math.abs(dx), Math.abs(dz))
    if (d < ring.min || d > ring.max) continue
    const away = Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'e' : 'w') : (dz > 0 ? 's' : 'n')
    out.push({ origin: { x: home.x + dx, z: home.z + dz }, away })
  }
  return out
}

/**
 * CAN A BOT WALK THERE AS THE WORLD STANDS? (Claude stage-1 P2: the collar rule read one column, not a route.) A breadth-
 * first walk over standable cells -- a solid, non-liquid block below, two passable non-liquid cells for feet and head --
 * with the pathfinder's own walk limits: step up 1, drop at most 3, no digging, no placing. -> { ok, nodes }. Pure over
 * read(); bounded by radius around the segment and maxNodes (an exhausted search answers false: fail closed).
 */
export function walkReach (read, from, to, { radius = 48, maxNodes = 80000, maxDrop = 3 } = {}) {
  const passable = b => !!b && b.boundingBox === 'empty' && !isLiquid(b)
  const floor = b => !!b && b.boundingBox === 'block' && !isLiquid(b)
  const stand = (x, y, z) => passable(read(x, y, z)) && passable(read(x, y + 1, z)) && floor(read(x, y - 1, z))
  const mx = (from.x + to.x) / 2, mz = (from.z + to.z) / 2
  const far = (x, z) => Math.max(Math.abs(x - mx), Math.abs(z - mz)) > radius + Math.max(Math.abs(from.x - to.x), Math.abs(from.z - to.z)) / 2
  const k = (x, y, z) => `${x},${y},${z}`
  const start = { x: Math.floor(from.x), y: Math.floor(from.y), z: Math.floor(from.z) }
  if (!stand(start.x, start.y, start.z)) return { ok: false, nodes: 0, why: 'start not standable' }
  const seen = new Set([k(start.x, start.y, start.z)]), q = [start]
  for (let h = 0; h < q.length; h++) {
    const c = q[h]
    if (c.x === to.x && c.y === to.y && c.z === to.z) return { ok: true, nodes: seen.size }
    if (seen.size > maxNodes) return { ok: false, nodes: seen.size, why: 'search exhausted' }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + dx, z = c.z + dz
      if (far(x, z)) continue
      for (let dy = 1; dy >= -maxDrop; dy--) {
        const y = c.y + dy
        if (dy === 1 && !passable(read(c.x, c.y + 2, c.z))) continue      // jumping needs head room above the start
        if (dy < 0) { let clear = true; for (let yy = c.y; yy > y; yy--) if (!passable(read(x, yy + 1, z))) clear = false; if (!clear) continue }
        if (!stand(x, y, z)) continue
        const key = k(x, y, z)
        if (!seen.has(key)) { seen.add(key); q.push({ x, y, z }) }
        break
      }
    }
  }
  return { ok: false, nodes: seen.size, why: 'no walk' }
}
