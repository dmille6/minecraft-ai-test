// ESCDEAD-01SHOW / ZONEWALK: AN ESCAPE FROM UNDER (OR INSIDE) A PROTECTED ZONE LEAVES BY A NON-ZONE ROUTE (tier 3, reflex scope).
//
// WHY (showcase, 11-06/07). showcase-Nova, entombed at 70,36,-9 deep under the taiga village village-taiga-6_1 (box y -64..90,
// floor_y 54), pillared straight up a natural shaft through ordinary rock (escapeguard counted `ordinary` digs) from y 36 to y 70
// -- right under a village house's spruce_planks floor at 79,72,-10. The ramp then refused every bearing (spruce planks and logs
// on every side: guarded), the wait ran 10 min, and the LAST RESORT opened: 79,72,-10 plank (15:18Z) and 80,77,-8 log (16:06Z)
// were dug. Two owner-directed repairs; Nova quarantined. 11-07 05:39Z showcase-Alpha, entombed at 53,12,31 (deep), climbed
// through an abandoned mineshaft under the same village and dug 3 oak_planks at 55,18..20,29 and two rails (CoreProtect): the
// zone's DEEP exemption let them through (guardOf asks protectzone.blocked, which opens deep cells to a deep bot).
// Every climb rung did the correct thing alone; together they walked the bot UP INTO the village, where the only way left was
// through it.
//
// THE RULE (all three, one switch ZONEWALK=off):
//   1. A structure block inside a zone box is guarded at EVERY depth (escapeguard guardOf): a mineshaft's planks and rails under
//      a village are the zone's too. Ordinary rock in the deep part stays open, as before.
//   2. THE CLIMB GATE: an escape climb (pillar, marooned climb) that starts inside a zone's footprint whose column (the bot's and
//      its 8 neighbours, up to the box top) holds a structure block is refused before it starts -- it would end under that block.
//      The arm treats it as a guarded ceiling (guardBranch), whose first move is now:
//   3. THE WALK-OUT: a straight 2-high tunnel at the bot's own height through ORDINARY rock toward the nearest side of the
//      footprint, then the next nearest, ...; a structure block, liquid, lava near, or a missing floor it cannot bridge ends that
//      bearing. From above the floor it may first step DOWN through ordinary rock. Out of the footprint, the ordinary climbs run
//      outside the zone. And the escape guard's LAST RESORT no longer digs a zone's structure blocks (records keep theirs): the
//      wait runs on, the walk-out is retried every firing, and `needs_rescue` calls for help. AIR FIRST is unchanged: a
//      suffocating or drowning bot may still dig anything (owner: never drown or suffocate it).
// THE CASE WITH NO EXIT, said plainly: a bot sealed on all four sides AND below by structure blocks (or water/lava) inside a zone
// -- e.g. already inside a closed house it dug into -- has no move that does not touch the village. It holds a dry cell, calls
// for help (`_zone_walk` outcome=no_exit + `needs_rescue`), and the showcase quarantines it. Rule 2 is what keeps bots out of
// that case: they no longer climb into it.
import { Vec3 } from 'vec3'
import { isOrdinary, zoneWalkOn } from './escapeguard.mjs'
import { isFallingBlock } from './scaffold.mjs'

/** ZONEWALK=off (0/false/no) turns all three rules off: the base escape guard, climbs and last resort. Default on. */
export { zoneWalkOn }

export const COLUMN_SCAN = 448         // the climb gate scans to the BOX TOP (Codex r1 blocker 6: a 48 cap missed a roof 60 up)
export const WALK_PAD = 1              // a tunnel is out once its feet column is this far beyond the footprint
export const WALK_MAX_STEPS = 140      // one firing (a 108-wide village box: the farthest side is 54 from the middle)
export const WALK_BUDGET_MS = 150_000  // one firing; the arm re-fires after its back-off and the tunnel continues
export const WALK_STEP_MS = 6_000      // walking into one cleared cell
export const WALK_DIG_MS = 12_000      // one dig (bare-handed stone is 7.5 s grounded)
export const DOWN_MAX = 20             // from above the floor: at most this far down before the tunnel

const solid = b => !!b && b.boundingBox === 'block'
const LIQUID = /water|lava|bubble_column/
const isLiquid = b => !!b && (LIQUID.test(b.name ?? '') || b.isWaterlogged === true)
const isLava = b => !!b && /lava/.test(b.name ?? '')
/** A block a survival dig may not break inside a zone: anything solid that is not ordinary terrain (escapeguard ORDINARY). */
export const isStructure = b => solid(b) && !isOrdinary(b.name ?? '')

/** Blocks that hang on or stand on another block (Claude r1 blocker 1): digging their support drops them -- a rail on a mineshaft
 *  floor, a torch, a lantern, a door, a sign, a carpet. A dug cell with one of these on top or beside it is not a tunnel cell. */
export const ATTACHED = /(rail|torch|lantern|sign|pressure_plate|button|lever|carpet|flower_pot|potted_|bell|chain|ladder|door|banner|candle|_head|skull|tripwire|string|bed)$|^(rail|redstone_wire|lever|vine|cobweb)$/
const attached = b => !!b && ATTACHED.test(b.name ?? '')

/** The zone whose BOX holds this cell -> zone | null. Pure. */
export function zoneBoxAt (zones, x, y, z) {
  for (const q of (Array.isArray(zones) ? zones : [])) {
    if (x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1 && z >= q.z0 && z <= q.z1) return q
  }
  return null
}

/**
 * THE CLIMB GATE'S QUESTION -> { zone, cell, name } | null. Pure over at(x,y,z) (null = unloaded: treated as a hit -- an
 * unseen column under a village is not a safe climb). The bot's feet cell inside a zone box; its OWN column (the pillar's: Codex
 * r1 -- a neighbour's roof must not suppress a clear climb the base could take; the ramp, which climbs diagonally, passes over
 * guarded cells itself), from feet+2 up to the box top: the first structure block found.
 */
export function zoneColumnHit ({ at = () => null, feet, zones = [], scan = COLUMN_SCAN } = {}) {
  if (!feet) return null
  const fx = Math.floor(feet.x), fy = Math.floor(feet.y), fz = Math.floor(feet.z)
  const zone = zoneBoxAt(zones, fx, fy, fz)
  if (!zone) return null
  const top = Math.min(zone.y1, fy + scan)
  for (let y = fy + 2; y <= top; y++) {
    for (const [dx, dz] of [[0, 0]]) {
      const b = at(fx + dx, y, fz + dz)
      if (b == null) return { zone, cell: [fx + dx, y, fz + dz], name: 'unloaded' }
      if (isStructure(b)) return { zone, cell: [fx + dx, y, fz + dz], name: b.name }
    }
  }
  return null
}

/** The four bearings out of the footprint, nearest side first -> [{ dx, dz, dist, side }]. Pure. */
export function walkBearings (zone, feet) {
  const x = Math.floor(feet.x), z = Math.floor(feet.z)
  return [
    { dx: -1, dz: 0, dist: x - zone.x0 + 1, side: 'west' }, { dx: 1, dz: 0, dist: zone.x1 - x + 1, side: 'east' },
    { dx: 0, dz: -1, dist: z - zone.z0 + 1, side: 'north' }, { dx: 0, dz: 1, dist: zone.z1 - z + 1, side: 'south' },
  ].sort((a, b) => a.dist - b.dist)
}

/** Is this feet column outside the footprint (by WALK_PAD)? Pure. */
export const outOfFootprint = (zone, x, z, pad = WALK_PAD) => x < zone.x0 - pad + 1 || x > zone.x1 + pad - 1 || z < zone.z0 - pad + 1 || z > zone.z1 + pad - 1

/**
 * ONE TUNNEL STEP -> { ok, dig: [[x,y,z]...], place: [x,y,z] | null, why }. Pure. From feet cell `from`, one cell along
 * (dx, dz): the next feet and head cells must be open or ORDINARY (never a structure block, never liquid), with no lava on any
 * face of the two cells; the next floor must be solid, or open air with a block to place (`canPlace`), never liquid.
 */
export function tunnelStep ({ at = () => null, from, dx, dz, canPlace = false } = {}) {
  const [x, y, z] = from
  const nx = x + dx, nz = z + dz
  const feetB = at(nx, y, nz), headB = at(nx, y + 1, nz), floorB = at(nx, y - 1, nz)
  if (feetB == null || headB == null || floorB == null) return { ok: false, dig: [], place: null, why: 'unloaded' }
  for (const [b, w] of [[headB, 'head'], [feetB, 'feet']]) {
    if (isStructure(b)) return { ok: false, dig: [], place: null, why: `structure ${b.name} at the ${w} cell ${nx},${w === 'head' ? y + 1 : y},${nz}` }
    if (isLiquid(b)) return { ok: false, dig: [], place: null, why: `${b.name} at the ${w} cell` }
  }
  for (const cy of [y, y + 1]) {
    for (const [ex, ey, ez] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
      const nb = at(nx + ex, cy + ey, nz + ez)
      if (nb == null) return { ok: false, dig: [], place: null, why: 'unloaded beside the cut' }
      if (isLava(nb)) return { ok: false, dig: [], place: null, why: `lava beside ${nx},${cy},${nz}` }
      // WATER ON A FACE (Codex r1 blocker 3): a cut beside or under water floods the 2-high tunnel the bot breathes in
      if (isLiquid(nb)) return { ok: false, dig: [], place: null, why: `${nb.name} beside ${nx},${cy},${nz}` }
      // A HANGING OR STANDING BLOCK on the cut (Claude r1 blocker 1): digging its support drops a zone block
      if (attached(nb)) return { ok: false, dig: [], place: null, why: `${nb.name} hangs on ${nx},${cy},${nz}` }
    }
  }
  // A FALLING BLOCK OVER THE HEAD CUT (Codex r1 blocker 4): it drops into the tunnel and whatever was above it (lava, water,
  // a structure) follows; never cut under one
  if (isFallingBlock(at(nx, y + 2, nz))) return { ok: false, dig: [], place: null, why: `${at(nx, y + 2, nz).name} over the head cut` }
  // a block that falls into the cut (sand/gravel over the head) is ordinary but refills it: dig it later as the step reads it
  const dig = [[nx, y + 1, nz], [nx, y, nz]].filter(c => solid(at(...c)))
  if (isLiquid(floorB)) return { ok: false, dig: [], place: null, why: `${floorB.name} under the next cell` }
  if (!solid(floorB)) {
    if (isLava(at(nx, y - 2, nz))) return { ok: false, dig: [], place: null, why: 'lava under the next cell' }
    if (!canPlace) return { ok: false, dig: [], place: null, why: 'no floor under the next cell and no block to bridge it' }
    return { ok: true, dig, place: [nx, y - 1, nz], why: null }
  }
  return { ok: true, dig, place: null, why: null }
}

/** ONE STEP DOWN (above the zone floor only) -> { ok, dig: [x,y,z] | null, why }. Pure: the cell under the feet is ordinary
 *  (or open), its own floor solid and dry, no lava near. */
export function downStep ({ at = () => null, from } = {}) {
  const [x, y, z] = from
  const below = at(x, y - 1, z), floor = at(x, y - 2, z)
  if (below == null || floor == null) return { ok: false, dig: null, why: 'unloaded' }
  if (isStructure(below)) return { ok: false, dig: null, why: `structure ${below.name} under the feet` }
  // a torch or carpet standing on the block it digs (in the bot's own feet cell) would drop (Claude r2 note)
  if (attached(at(x, y, z))) return { ok: false, dig: null, why: `${at(x, y, z).name} stands on the block under the feet` }
  if (isLiquid(below) || isLiquid(floor)) return { ok: false, dig: null, why: 'liquid under the feet' }
  for (const [ex, ez] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const a = at(x + ex, y - 1, z + ez), b = at(x + ex, y - 2, z + ez)
    if (a == null || b == null) return { ok: false, dig: null, why: 'unloaded beside the drop' }
    if (isLava(a) || isLava(b)) return { ok: false, dig: null, why: 'lava beside the drop' }
    if (isLiquid(a)) return { ok: false, dig: null, why: `${a.name} beside the drop` }
    if (attached(a)) return { ok: false, dig: null, why: `${a.name} hangs on the cell under the feet` }
  }
  if (!solid(floor)) return { ok: false, dig: null, why: 'no floor two below (a drop, not a step)' }
  return { ok: true, dig: solid(below) ? [x, y - 1, z] : null, why: null }
}

/** How far the feet column is from leaving the footprint -> cells (0 = out). Pure. */
export const distanceOut = (zone, x, z) => (outOfFootprint(zone, x, z) ? 0 : Math.min(x - zone.x0 + 1, zone.x1 - x + 1, z - zone.z0 + 1, zone.z1 - z + 1))

/** The `_zone_walk` row's detail. Pure. */
export function zoneWalkRowDetail (r = {}) {
  return `outcome=${r.outcome} zone=${r.zone ?? '-'} from=${r.from ?? '-'} to=${r.to ?? '-'} steps=${r.steps ?? 0} down=${r.down ?? 0} ` +
         `dug=${r.dug ?? 0} placed=${r.placed ?? 0} side=${r.side ?? '-'} ms=${r.ms ?? 0}${r.stops?.length ? ` stops=${r.stops.join(' | ').slice(0, 220)}` : ''}`
}

/**
 * THE WALK-OUT -> { outcome: 'out'|'progress'|'no_exit'|'yielded'|'failed', ... }. Steers ONE body: from above the zone floor,
 * first down (at most DOWN_MAX) while the cell under it is ordinary and the floor below it solid; then a straight tunnel along
 * the nearest bearing, then the next, until the feet column is out of the footprint. Effects are injected (the reflex's own:
 * the escape tool policy + the escape guard's dig, a scaffold place, a one-cell walk), so this file stays pure-testable.
 *   dig(block) -> Promise         place(cell, dir) -> Promise<boolean>  walk(cell) -> Promise   (each may throw)
 *   alive() -> bool               yieldTo() -> reason | null          canPlace() -> bool
 */
export async function zoneWalkOut (bot, { zone, dig, place = async () => false, walk, canPlace = () => false, alive = () => true,
  yieldTo = () => null, now = Date.now, budgetMs = WALK_BUDGET_MS, best = null } = {}) {
  const t0 = now()
  const at = (x, y, z) => { try { return bot.blockAt?.(new Vec3(x, y, z)) ?? null } catch { return null } }
  const here = () => { const p = bot.entity.position; return [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)] }
  const start = here()
  const res = { outcome: 'failed', zone: zone?.id ?? '?', from: start.join(','), to: null, steps: 0, down: 0, dug: 0, placed: 0, side: null, ms: 0, stops: [] }
  // PROGRESS IS GETTING NEARER THE WAY OUT (Codex r1 blocker 5), never walking: a firing that ends no nearer the footprint's
  // side (and no lower, from above the floor) than the best this episode reached is no progress -- so a sealed corridor walked
  // end to end reports no_exit and calls for help instead of resetting the arm forever. `best` = { dist, y } carried by the
  // caller across firings (null: this firing's start).
  const b0 = best && Number.isFinite(best.dist) ? best : { dist: distanceOut(zone, start[0], start[2]), y: start[1] }
  const settle = o => {
    const h = here(), d = distanceOut(zone, h[0], h[2])
    const nearer = d < b0.dist || (zone.floorY != null && b0.y >= zone.floorY && h[1] < b0.y)
    res.best = { dist: Math.min(d, b0.dist), y: Math.min(h[1], b0.y) }
    if (o === 'progress' && !nearer) return 'no_exit'
    if (o === 'out' || d === 0) return 'out'
    return o
  }
  const fin = o => { res.outcome = settle(o); res.to = here().join(','); res.ms = now() - t0; return res }
  const gone = () => { if (!alive()) return 'ownership lost'; return yieldTo() }
  class Gone extends Error {}
  // OWNERSHIP BEFORE EVERY EFFECT (Codex r1 blocker 7): a rescue that took the body during a dig never meets a second dig,
  // an equip or a placement from this firing
  const own = () => { const g = gone(); if (g) throw new Gone(g) }
  const digCell = async c => { const b = at(...c); if (!solid(b)) return; own(); await dig(b); res.dug++; if (solid(at(...c))) throw new Error(`${b.name} at ${c.join(',')} still stands after the dig`) }
  try {
    if (outOfFootprint(zone, start[0], start[2])) return fin('out')
    // 1. DOWN, from above the floor of a VILLAGE (its structures stand on the surface: leave them from below). Not for a zone
    // whose structure is underground (Claude r1 note 4: trial chambers under the town) -- there, down is toward it.
    while (zone.kind === 'village' && zone.floorY != null && here()[1] >= zone.floorY && res.down < DOWN_MAX) {
      if (gone()) return fin('yielded')
      if (now() - t0 > budgetMs) return fin(res.steps || res.down ? 'progress' : 'failed')
      const d = downStep({ at, from: here() })
      if (!d.ok) { res.stops.push(`down: ${d.why}`); break }
      const y0 = here()[1]
      if (d.dig) await digCell(d.dig)
      own()
      await walk([here()[0], y0 - 1, here()[2]])
      if (here()[1] >= y0) { res.stops.push('down: did not drop'); break }
      res.down++
    }
    // 2. THE TUNNEL, nearest side first
    for (const b of walkBearings(zone, { x: here()[0], z: here()[2] })) {
      res.side = b.side
      for (let i = 0; i < WALK_MAX_STEPS; i++) {
        if (gone()) return fin('yielded')
        if (now() - t0 > budgetMs) return fin(res.steps || res.down ? 'progress' : 'failed')
        const f = here()
        if (outOfFootprint(zone, f[0], f[2])) return fin('out')
        const s = tunnelStep({ at, from: f, dx: b.dx, dz: b.dz, canPlace: canPlace() })
        if (!s.ok) { res.stops.push(`${b.side} at ${f.join(',')}: ${s.why}`); break }
        for (const c of s.dig) await digCell(c)
        // RE-READ AFTER THE DIGS (Codex r1 blocker 4): a block that fell in, or a liquid that arrived, ends the bearing
        const again = tunnelStep({ at, from: f, dx: b.dx, dz: b.dz, canPlace: canPlace() })
        const target = [f[0] + b.dx, f[1], f[2] + b.dz]
        if (!again.ok || again.dig.length) { res.stops.push(`${b.side}: the cut changed after the dig (${again.why ?? 'refilled'})`); break }
        if (s.place) { own(); if (!(await place(s.place, [b.dx, 0, b.dz]))) { res.stops.push(`${b.side}: the bridge block did not take`); break } res.placed++ }
        own()
        await walk(target)
        const g = here()
        if (g[0] !== target[0] || g[2] !== target[2]) { res.stops.push(`${b.side}: the step to ${target.join(',')} was not taken`); break }
        res.steps++
      }
    }
    return fin(res.steps || res.down ? 'progress' : 'no_exit')
  } catch (e) {
    if (e instanceof Gone) { res.stops.push(`yielded: ${e.message}`); res.outcome = 'yielded'; res.to = here().join(','); res.ms = now() - t0; return res }
    res.stops.push(`threw: ${e?.message ?? e}`)
    return fin(res.steps || res.down ? 'progress' : 'failed')
  }
}
