// THE SHAFT'S RESERVED VOLUME (shaft-01; design 4.1/4.3). PURE, and importing only shaftplan.mjs, so structures.mjs can read
// it without an import cycle (structures -> shaftjob -> monumentjob -> structures).
import { toWorld, envelopeLevels } from './shaftplan.mjs'

export const validSite = s => !!s && !!s.origin && Number.isInteger(s.origin.x) && Number.isInteger(s.origin.z) && ['n', 's', 'e', 'w'].includes(s.away) && Number.isInteger(s.c)

/** World (x, z) -> local (u, v) for an orientation (the inverse of shaftplan.toWorld). Pure. */
export function toLocal (origin, away, x, z) {
  const dx = x - origin.x, dz = z - origin.z
  const n = (u, v) => ({ u: u || 0, v: v || 0 })   // never -0 (a key 'u,y,v' of -0 prints as 0, but a deepEqual does not)
  switch (away) {
    case 's': return n(dx, dz)
    case 'n': return n(-dx, -dz)
    case 'e': return n(-dz, dx)
    case 'w': return n(dz, -dx)
  }
  throw new Error(`bad orientation ${away}`)
}


/**
 * THE RESERVED VOLUME -> { kind: 'shaft', has, core, inEnvelope, roleAt, bottom, top, base, box } | null. Pure over the
 * record. Reserved: every envelope dig cell (core, portals, rooms, stubs -- open air or ladder once built) and every shell
 * (lining) cell, for EVERY level c..bottom from the moment the record exists. NOT reserved (design 4.1): the stub end face
 * (v = 9) and beyond, and the entry pad (0..1, c, -1). A malformed record reserves nothing.
 */
export function shaftIndex (rec) {
  const s = rec?.site
  // THE RESERVATION IS THE PLANNED ENVELOPE (Codex shaft plan r1 P1-4): plan_bottom/plan_landings never move, so a stop above
  // a liquid or a cavity never un-reserves cells a builder already disturbed below it
  const pb = rec.plan_bottom ?? rec.bottom, pl = rec.plan_landings ?? rec.landings
  // an ABANDONED record with built levels keeps its reservation (Claude plan r2 P3): only one that never opened a level frees it
  if (!validSite(s) || !Number.isInteger(pb) || pb > s.c || (rec.state === 'abandoned' && !(rec.frontier <= s.c))) return null
  const landings = (Array.isArray(pl) ? pl : []).filter(y => Number.isInteger(y) && y >= pb && y < s.c)
  const env = envelopeLevels(s.c, pb, landings)
  const dig = new Map(), shell = new Set()
  for (const [u, y, v, role] of env.dig) dig.set(`${u},${y},${v}`, role)
  for (const [u, y, v] of env.shell) shell.add(`${u},${y},${v}`)
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const k of [...dig.keys(), ...shell]) {
    const [u, , v] = k.split(',').map(Number)
    const w = toWorld(s.origin, s.away, u, v)
    x0 = Math.min(x0, w.x); x1 = Math.max(x1, w.x); z0 = Math.min(z0, w.z); z1 = Math.max(z1, w.z)
  }
  const local = (x, y, z) => { if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null; const l = toLocal(s.origin, s.away, Math.floor(x), Math.floor(z)); return `${l.u},${Math.floor(y)},${l.v}` }
  const has = (x, y, z) => { const k = local(x, y, z); return !!k && (dig.has(k) || shell.has(k)) }
  const roleAt = (x, y, z) => { const k = local(x, y, z); return !k ? null : dig.get(k) ?? (shell.has(k) ? 'lining' : null) }
  const core = (x, y, z) => dig.get(local(x, y, z) ?? '') === 'core'
  const inEnvelope = (x, y, z) => dig.has(local(x, y, z) ?? '')
  // THE WAY OFF (Codex shaft plan r1 P2: a box side at depth is solid rock behind reserved lining, not a remedy): on the surface
  // (feet >= c - 1) the cell two beyond the box's nearest side; below it, the entry pad (the evacuation's destination)
  const box = { x0, x1, z0, z1 }
  const pad = (() => { const w = toWorld(s.origin, s.away, 0, -1); return { x: w.x, y: s.c, z: w.z } })()
  const exit = p => {
    if (!p || p.x < box.x0 || p.x > box.x1 || p.z < box.z0 || p.z > box.z1) return null
    if (p.y < s.c - 1) return pad
    const opts = [{ x: box.x0 - 2, z: p.z, d: p.x - box.x0 }, { x: box.x1 + 2, z: p.z, d: box.x1 - p.x }, { x: p.x, z: box.z0 - 2, d: p.z - box.z0 }, { x: p.x, z: box.z1 + 2, d: box.z1 - p.z }]
    opts.sort((a, b) => a.d - b.d)
    return { x: opts[0].x, y: s.c, z: opts[0].z }
  }
  // ABOVE THE COLLAR (Claude shaft plan r1 P1-4: getMoveDiagonal's drop-by-1 and getMoveForward's place charge land on the
  // cells above the collar): the two cells over each collar cell, for the step and place refusals
  const aboveCollar = (x, y, z) => { const k = local(x, y, z); if (!k) return false; const [u, yy, v] = k.split(',').map(Number); return v === 0 && (u === 0 || u === 1) && (yy === s.c + 1 || yy === s.c + 2) }
  return { kind: 'shaft', has, core, inEnvelope, roleAt, exit, pad, aboveCollar, base: s.c, top: s.c, bottom: pb - 1, box, site: s, landings, frontier: rec.frontier }
}


const FALLING_N = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|.*concrete_powder)$/
const WET_N = /^(water|lava|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/
const wetB = b => !!b && (WET_N.test(b.name ?? '') || b.props?.waterlogged === true || b.props?.waterlogged === 'true')
/** A cell a body can occupy: empty collision or a ladder, never liquid. */
export const bodyOpen = b => !!b && (b.boundingBox === 'empty' || b.name === 'ladder') && !wetB(b)
/** THE ONE WALL/FLOOR PREDICATE (Codex shaft plan r2 P2): full cube, not liquid, not a ladder; a falling block only while its
 *  own support below is solid. Construction, verification and audits all use this. */
export const goodSolid = (b, below = null) => !!b && b.boundingBox === 'block' && b.name !== 'ladder' && !wetB(b) && b.full !== false && (!FALLING_N.test(b.name ?? '') || (!!below && below.boundingBox === 'block' && !wetB(below)))

/**
 * A VERIFIED, EXECUTABLE LADDER EXIT from where a bot stands -> { ok, col, from, route, why }. Pure over read(x, y, z) ->
 * block | null (null = unloaded: never an exit). Codex shaft plan r2 P1: a ROUTE, not a column -- from the bot's actual
 * feet cell (in the envelope, feet and head open), through 4-adjacent open cells on its own level (no diagonal steps, no
 * skipped cells), to a core column cell; then that column's ladders, every one present with its KNOWN, correct facing, from
 * there to c-1; then the collar cell and the cell above it open; then the pad cell beside it (feet and head open) on a
 * proven floor. Used by the dig chokepoint, the reflex gate and shaft_exit (which follows this route).
 */
export function ladderExit (idx, read, feet, { capOk = false } = {}) {
  if (!idx || !feet) return { ok: false, why: 'no shaft' }
  const s = idx.site
  const fx = Math.floor(feet.x), fy = Math.floor(feet.y + 1e-6), fz = Math.floor(feet.z)
  if (!idx.inEnvelope(fx, fy, fz)) return { ok: false, why: 'not in the shaft' }
  const L = toLocal(s.origin, s.away, fx, fz)
  const at = (u, y, v) => { const w = toWorld(s.origin, s.away, u, v); return read(w.x, y, w.z) }
  const inDig = (u, y, v) => { const w = toWorld(s.origin, s.away, u, v); return idx.inEnvelope(w.x, y, w.z) }
  // A CELL TO WALK THROUGH: feet and head open AND a footing -- a stable floor, or (a column cell) a ladder that holds the bot
  // (Codex code r1 P1-4: a route across a missing floor is no route)
  const stand = (u, y, v) => bodyOpen(at(u, y, v)) && bodyOpen(at(u, y + 1, v)) &&
    (goodSolid(at(u, y - 1, v), at(u, y - 2, v)) || (v === 0 && (u === 0 || u === 1) && at(u, y, v)?.name === 'ladder'))
  if (!stand(L.u, fy, L.v)) return { ok: false, why: 'the bot\'s own cell is not open or has no footing' }
  // BFS on the bot's level over envelope cells (feet and head open) to the core columns
  const key = (u, v) => `${u},${v}`
  const prev = new Map([[key(L.u, L.v), null]]), q = [[L.u, L.v]]
  for (let h = 0; h < q.length && q.length < 200; h++) {
    const [u, v] = q[h]
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nu = u + du, nv = v + dv, k = key(nu, nv)
      if (prev.has(k) || !inDig(nu, fy, nv) || !stand(nu, fy, nv)) continue
      prev.set(k, [u, v]); q.push([nu, nv])
    }
  }
  const ladderOn = (b, u) => !!b && b.name === 'ladder' && b.facing != null && b.facing === ladderFacing(s.away, u)
  // the bot's OWN column first when it qualifies (Claude code r1 P3: never a sideways step it does not need)
  for (const col of (L.v === 0 && (L.u === 0 || L.u === 1) ? [L.u, 1 - L.u] : [1, 0])) {
    if (!prev.has(key(col, 0))) continue
    let ok = true
    for (let y = fy; y <= s.c - 1 && ok; y++) {
      const b = at(col, y, 0)
      // the bot's own level may be the column's floor stand (air over a proven floor) only where it stands
      if (y === fy && !ladderOn(b, col)) { if (!(bodyOpen(b) && goodSolid(at(col, y - 1, 0), at(col, y - 2, 0)) && ladderOn(at(col, y + 1, 0), col))) ok = false }
      else if (y !== fy && !ladderOn(b, col)) ok = false
    }
    if (!ok) continue
    // THE COLLAR: open; or (capOk: a bot that can dig cobble) the cap's cobble, dug from the top rung (Claude plan r2 P2-1)
    const capB = at(col, s.c, 0), capped = goodSolid(capB, null)
    if (!((bodyOpen(capB) || (capOk && capped)) && bodyOpen(at(col, s.c + 1, 0)))) continue
    if (!(bodyOpen(at(col, s.c, -1)) && bodyOpen(at(col, s.c + 1, -1)) && goodSolid(at(col, s.c - 1, -1), at(col, s.c - 2, -1)))) continue
    const route = []
    for (let k = [col, 0]; k; k = prev.get(key(...k))) route.unshift({ u: k[0], y: fy, v: k[1] })
    return { ok: true, col, from: fy, route, pad: { u: col, y: s.c, v: -1 }, capped }
  }
  return { ok: false, why: 'no reachable, continuous, correctly-facing ladder column to an open collar and a proven pad' }
}
/** The facing a ladder on column u's wall has, in world terms (the ladder faces AWAY from its wall: column 0 faces +u). */
export function ladderFacing (away, u) {
  // local +u in world: s -> +x (east), n -> -x (west), e -> -z (north), w -> +z (south)
  const plus = { s: 'east', n: 'west', e: 'north', w: 'south' }[away], minus = { s: 'west', n: 'east', e: 'south', w: 'north' }[away]
  return u === 0 ? plus : minus
}
