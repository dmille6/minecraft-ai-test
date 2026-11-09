// COUNTRY-01 (OWNER 11-07 "i'd like all areas like this to be smoothed out and made to look pretty" -- inside the walls AND the
// countryside; OWNER 11-09 "i want all of those things done": the countryside in RINGS out from the wall, IN PARALLEL with the
// inside-the-wall stage, by the groundskeeper and its helpers; meadows, flower drifts and tree groves).
// Design: docs/reports/country-design-2026-11-09.md (Claude + Codex engines, independent, reconciled: both chose a SEPARATE record).
//
// MEASURED (showcase snapshot 11-09 12:10Z, the bots' own tidy.mjs siteStage run offline per band): the bands rim48/64/80 hold 633 +
// 986 + 964 fill cells and 224 + 498 + 420 cuts -- the inside stage's size again -- and wait today until the inside stage (2,601 cells,
// 15.5 fills/h) closes, because the land plan is ONE record chain worked stage by stage. Outside the wall ~38 flowers stand in ~63,000
// columns.
//
// THE MODEL. The countryside is its OWN record chain, `project-<home>.country` (blueprint country@1, the tidy record's shape: cells /
// cut / clear / replant / segments), worked by buildTidy's visit with the lane `country` (skills.mjs). Its stages are the bands
// outside the walls (countryStages: c48 = everything outside the wall boxes out to 48, then 16-wide rings to COUNTRY.r), each sited by
// tidy.mjs siteStage over that band with the classic square survey off (`classic: false`: the band survey alone, which never reaches
// inside the wall boxes) plus this module's PLANTINGS (groves, flower drifts) on the band's untouched grass. The cursor is the head's
// `stageId`; after the last band it wraps to the first after COUNTRY.cycleMs (a re-survey: what the bots roughed up since).
// With COUNTRY on, the inside chain stops at the inside-the-wall stage (landplan.mjs nextStageCycle `inner`) -- the bands are the
// country chain's alone. COUNTRY=off is the rollback: the inside chain's ring order exactly as before; a sited country record is never
// visited again.
//
// THE CREW (one crew, two lanes; the owner's 11-08 cap unchanged): the keeper and its helpers keep their leases on the tidy key. A
// HELPER's visit works its SIDE (countrySide: the upper half of the helper leases, helper3/helper4 under the big cap, helper2 under the
// small one, works the country) and borrows the other lane when its own has no open work. The KEEPER works the inside and visits the
// country when the country wants siting or its completion, at most every COUNTRY.keeperEveryMs while the inside has work (groundsLane).
//
// PURE: the switch, the knobs, the stages and the cursor, the lane choice, the plantings and the rows. Nothing here touches a bot.

import { LAND, fnv1a, rng } from './landplan.mjs'
import { isLiquid, replaceableCell } from './townplan.mjs'

const k2 = (x, z) => `${x},${z}`
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const AIR = /^(air|cave_air|void_air)$/
const LOG = /_(log|wood)$|^mangrove_roots$/
const LEAVES = /_leaves$/
const GRASSY = /^(short_grass|tall_grass|fern|large_fern)$/

export const COUNTRY_PLOT = 'country'
export const COUNTRY_BLUEPRINT = 'country@1'
/** THE SWITCH -> bool. COUNTRY=off|0|false|no -> the land plan as before (the bands on the tidy chain, after the inside); COUNTRY=on
 *  -> on; unset: every NAMED pool (the groundskeeper's own default: a test bot or a scratch run keeps the ring order as before). The
 *  lane runs only where the groundskeeper and the land plan do (skills.mjs). Pure. */
export function countryOn (env = process.env, pool = '') {
  const v = String(env?.COUNTRY ?? '').trim().toLowerCase()
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false
  if (v === 'on' || v === '1' || v === 'true') return true
  return !!String(pool ?? '').trim()
}
/** PLANTINGS: COUNTRY_PLANT=off -> earthwork only. Pure. */
export const countryPlantOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.COUNTRY_PLANT ?? '').trim())

export const COUNTRY = Object.freeze({
  r: 128,                      // the outermost band's edge (Chebyshev from home); the land plan's roads end at LAND.workR (80)
  step: 16,                    // a band's width (LAND.rimStep)
  first: 48,                   // the first band: everything outside the wall boxes out to here (the collar between the wall and 32 too)
  builders: 3,                 // the record's slots: the keeper and two country-side helpers
  keeperEveryMs: 60 * 60_000,  // the keeper's country visit at most this often while the inside has work (siting, completion, clears)
  cycleMs: 2 * 60 * 60_000,    // after the last band is complete this long, the first band again (a re-survey of the countryside: the
                               // bands' sitings read up to ~0.5M cells each; the inside's cycle is 30 min)
  // PLANTINGS (Codex + Claude design; forest-01's Paper: spruce in a spacing-3 grid grows 68/68; REPLANT_AIR 6 for birch)
  grovePer: 400,               // one grove per this many eligible grass columns of the band
  groveMin: 3, groveMax: 5,    // saplings a grove
  groveGap: 3,                 // Chebyshev between two saplings of a grove (never 2x2: a spruce 2x2 grows one mega tree)
  groveLogR: 5,                // no log within this many columns of a grove's centre (groves where the trees are not)
  groveSep: 12,                // centres at least this far apart
  air: 6,                      // clear cells above a sapling's soil
  driftPer: 256,               // one flower drift per this many eligible grass columns
  driftMin: 5, driftMax: 9,    // flowers a drift (one species: one role)
  driftR: 2,                   // a drift's radius round its centre
  driftSep: 10,                // drift centres apart (and from a grove)
  plantMax: 160,               // planting cells a band at most
  segCells: 24,                // planting cells a segment
  edge: 2,                     // columns kept clear of a road, a path, a record box (avoid), the wall boxes
  dy: 14,                      // the column read's height band round home.y (tidy.mjs TIDY.dy)
})

/**
 * THE COUNTRY'S STAGES -> [{ k, id, rMin, rMax, roads, upto, country: true }]. Pure. The first band takes everything outside the
 * wall boxes out to C.first (rMin 0: siteStage's band survey keeps off the wall boxes and the classic survey is off), then C.step-
 * wide rings to C.r. A band inside the land plan's reach keeps its spokes' grading (`roads: 'spokes'`, `k` the land plan's own band
 * number so tidy.mjs stageRoadCols reads the band before it); past it, no roads.
 */
export function countryStages (L = LAND, C = COUNTRY) {
  const out = []
  let rMin = 0, k = 4, i = 0
  for (let rMax = C.first; rMin < C.r; rMax = Math.min(C.r, rMax + C.step)) {
    const roads = rMax <= L.workR + C.step && rMin < L.workR
    out.push({ k: roads ? k : 100 + i, id: `c${rMax}`, rMin, rMax, roads: roads ? 'spokes' : null, upto: roads ? Math.min(L.workR, rMax + L.rimStep) : -1, country: true })
    rMin = rMax; k++; i++
    if (rMax >= C.r) break
  }
  return out
}
export const countryStageOf = (id, L = LAND, C = COUNTRY) => countryStages(L, C).find(s => s.id === id) ?? null

/**
 * THE COUNTRY'S NEXT STAGE -> stage | null. Pure. No head: the first band. An open head: none (it is worked). A complete head: the band
 * after it; after the last band, once the head has been complete C.cycleMs, the first band again. A head whose stage this build does not
 * know (a rollback's, a renamed band): the first band.
 */
export function countryNext (rec, now = Date.now(), { L = LAND, C = COUNTRY } = {}) {
  const st = countryStages(L, C)
  if (!rec) return st[0] ?? null
  if (!rec.structure_complete) return null
  const i = st.findIndex(s => s.id === rec.stageId)
  if (i < 0) return st[0] ?? null
  if (i + 1 < st.length) return st[i + 1]
  const at = Number(rec.completeAt)
  return Number.isFinite(at) && at <= now + 60_000 && now - at >= C.cycleMs ? st[0] : null
}
/** The bands to try from `next` on, in order, then (wrapping) none: a band with nothing to do is passed. Pure. */
export function countryTryOrder (next, { L = LAND, C = COUNTRY } = {}) {
  const st = countryStages(L, C)
  const i = next ? st.findIndex(s => s.id === next.id) : -1
  return i < 0 ? [] : st.slice(i)
}
/**
 * WHAT THE COUNTRY WANTS NOW -> 'site' (no record, or a complete one whose next band is due) | 'open' (a sited band with work) |
 * null (complete, nothing due yet). Pure.
 */
export function countryDemand (rec, now = Date.now(), opts = {}) {
  if (rec && !rec.structure_complete) return 'open'
  return countryNext(rec, now, opts) ? 'site' : null
}

/**
 * A HELPER LEASE'S SIDE -> 'country' | 'inside'. Pure. The upper half of the helper leases under the cap works the country: with four
 * helpers helper3 and helper4, with two helper2, with three helper3; with one, none (the inside keeps its helper).
 */
export function countrySide (name, cap) {
  const m = /^helper(\d+)$/.exec(String(name ?? ''))
  const n = m ? Number(m[1]) : 0, c = Math.max(0, Number(cap) || 0)
  return c >= 2 && n > Math.ceil(c / 2) ? 'country' : 'inside'
}

/**
 * THE VISIT'S LANE -> { lane: 'inside' | 'country', why }. Pure.
 *   on       countryOn()
 *   role     'keeper' | 'helper'; helper: its lease name; cap: helpersCap now
 *   inside   { open, due }: the tidy head is open / wants siting
 *   country  { demand: countryDemand(head) }
 *   lastCountryAt  the keeper's last country visit (ms)
 * KEEPER: the country when it wants SITING (its next band: one visit's start, then the band is worked), or when the inside has no work;
 * an open band at most every C.keeperEveryMs while the inside has work (its completion, clears and waivers are the keeper's); else
 * the inside.
 * HELPER: its side when that lane has open work; else the other lane's open work (borrowed); else its side (the visit names why).
 * A helper never takes the country to site it (the siting is the keeper's: the visit ends keeper_plan there).
 */
export function groundsLane ({ on = true, role = 'keeper', helper = null, cap = 2, inside = {}, country = {}, lastCountryAt = -Infinity, now = Date.now(), C = COUNTRY } = {}) {
  if (!on) return { lane: 'inside', why: 'off' }
  const inWork = !!(inside.open || inside.due)
  const cDemand = country.demand ?? null
  if (role === 'keeper') {
    if (!cDemand) return { lane: 'inside', why: 'country_quiet' }
    if (cDemand === 'site') return { lane: 'country', why: 'site' }
    if (!inWork) return { lane: 'country', why: `inside_quiet:${cDemand}` }
    if (now - (Number.isFinite(lastCountryAt) ? lastCountryAt : -Infinity) >= C.keeperEveryMs) return { lane: 'country', why: `keeper_turn:${cDemand}` }
    return { lane: 'inside', why: 'keeper_inside' }
  }
  const side = countrySide(helper, cap)
  const open = { inside: !!inside.open, country: cDemand === 'open' }
  if (open[side]) return { lane: side, why: `side:${side}` }
  const other = side === 'country' ? 'inside' : 'country'
  if (open[other]) return { lane: other, why: `borrow:${other}` }
  return { lane: side, why: `side_quiet:${side}` }
}

/**
 * THE GROUNDS STATE (shopActive's tidy entry) WITH THE COUNTRY -> the state the keeper and crew orders read. Pure. The crew is wanted
 * while EITHER lane has work: a quiet inside (complete, nothing due) reads DUE when the country wants siting (as a due inside stage
 * reads: recordDamaged's `due`, never `damaged` -- a damaged tidy would be every bot's repair) and OPEN while a band is worked, so the
 * keeper and the country-side helpers keep their leases. An inside with work of its own is left as it is.
 */
export function groundsState (st, demand) {
  if (!st || !demand) return st
  if (st.exists && !st.complete) return st
  if (st.exists && st.complete && (st.damaged || st.due)) return st
  if (demand === 'open') return { ...st, exists: true, complete: false, damaged: false, due: false, country: demand }
  return { ...st, exists: true, complete: true, damaged: false, due: true, country: demand }
}

// ---- THE PLANTINGS ------------------------------------------------------------------------------------------------------------
/** The grove role by the band's own trees: the sapling list that starts with the species standing most (park.mjs PARK_PALETTE). */
export const GROVE_ROLE = Object.freeze({ oak: 'sapling0', birch: 'sapling1', cherry: 'sapling2', spruce: 'sapling3' })
const SPECIES_OF = n => /^(oak|dark_oak|pale_oak)_log$/.test(n) ? 'oak' : n === 'birch_log' ? 'birch' : n === 'cherry_log' ? 'cherry' : n === 'spruce_log' ? 'spruce' : null

/** A column's ground -> { y, name, open } | null: the top solid non-leaf, non-log block in the height band, and whether the cell above
 *  it is open (air, or a plant a planting replaces). Liquid or unread: null. Pure. */
export function groundAt (read, x, z, { yHi, yLo }) {
  for (let y = yHi; y >= yLo; y--) {
    const b = read(x, y, z)
    if (!b) return null
    const n = nm(b)
    // a snow layer is the ground's cover, never its top (one layer is replaceable: townplan.mjs replaceableCell)
    if (AIR.test(n) || LEAVES.test(n) || GRASSY.test(n) || n === 'snow' || b.boundingBox === 'empty') continue
    if (isLiquid(b) || String(b.name ?? '').includes('waterlogged')) return null
    if (LOG.test(n)) return { y, name: n, log: true, open: false }
    const up = read(x, y + 1, z)
    return { y, name: n, log: false, open: !!up && (AIR.test(nm(up)) || replaceableCell(up)) && !isLiquid(up) }
  }
  return null
}
/** Is the column's soil a planting's (grass, or dirt that greens) with `air` clear cells above? Pure. */
function roomAbove (read, x, y, z, air) {
  // Paper proof 11-09: a one-layer snow cover is room (a placement replaces it: townplan.mjs replaceableCell), as short grass is
  for (let d = 1; d <= air; d++) { const b = read(x, y + d, z); if (!b) return false; const n = nm(b); if (!(AIR.test(n) || GRASSY.test(n) || replaceableCell(b) || (d > 2 && LEAVES.test(n)))) return false }
  return true
}

/**
 * THE BAND'S PLANTINGS -> { cells: [{ at, role, seg }], segments: [{ seg, deps }], census }. Pure over `read`.
 *   band     the stage ({ rMin, rMax, id })
 *   inWall(x, z)    a column inside the wall boxes (never planted)
 *   busy     Set of 'x,z' the band's earthwork touches (never planted: the ground there changes)
 *   avoid(x, z)     the tidy's refusals (zones, records + margin, wells, the farm) -> reason | null
 *   reserved(x, z)  the reservations (site preps, markers, the landmark, lawns) -> truthy
 *   corridor(x, z)  a land-plan road corridor -> truthy; pathCols Set 'x,z' (the laid paths)
 *   cells    Set 'x,y,z' every record cell (never planted on)
 *   seed     the town's land seed
 * ELIGIBLE: a column of the band whose ground is grass with an open cell above, no water beside it, its four neighbours' ground within
 * 1 of it, at least C.edge columns from a road, a path, a refusal, the wall boxes and the band's earthwork. GROVES (C.grovePer eligible
 * columns each): a centre with no log within C.groveLogR, then C.groveMin..C.groveMax saplings C.groveGap apart, each with C.air clear
 * above (the species role by the band's own logs). DRIFTS (C.driftPer each): C.driftMin..C.driftMax flowers within C.driftR of a centre,
 * one role a drift (park.mjs flower0..3, so drifts lead with different species). Every planting is a park role: with nothing in the bag
 * it is passed (park.mjs terraceSkip), never a blocker.
 */
export function countryPlantings (read, { home, band, inWall = () => false, busy = new Set(), avoid = () => null, reserved = () => false, corridor = () => null, pathCols = new Set(), cells = new Set(), seed = 0, C = COUNTRY } = {}) {
  const census = { cols: 0, eligible: 0, groves: 0, saplings: 0, drifts: 0, flowers: 0, skipped: {} }
  const skip = why => { census.skipped[why] = (census.skipped[why] ?? 0) + 1 }
  if (!home || !band) return { cells: [], segments: [], census }
  const yHi = home.y + C.dy, yLo = home.y - C.dy
  const dh = (x, z) => Math.max(Math.abs(x - home.x), Math.abs(z - home.z))
  const R = band.rMax + C.edge + 1
  const ground = new Map()
  const g = (x, z) => { const k = k2(x, z); if (!ground.has(k)) ground.set(k, groundAt(read, x, z, { yHi, yLo })); return ground.get(k) }
  // the edge rule: a column within C.edge of anything the plantings keep off
  const blocked = (x, z) => inWall(x, z) || !!avoid(x, z) || !!reserved(x, z) || !!corridor(x, z) || pathCols.has(k2(x, z))
  // the band's own earthwork: its columns and their 4-neighbours only (the ground there changes; a planting beside a fill stands)
  const worked = (x, z) => busy.has(k2(x, z)) || busy.has(k2(x + 1, z)) || busy.has(k2(x - 1, z)) || busy.has(k2(x, z + 1)) || busy.has(k2(x, z - 1))
  const species = {}
  const elig = []
  for (let x = home.x - band.rMax; x <= home.x + band.rMax; x++) {
    for (let z = home.z - band.rMax; z <= home.z + band.rMax; z++) {
      const d = dh(x, z)
      if (!(d > band.rMin && d <= band.rMax)) continue
      census.cols++
      const c = g(x, z)
      if (!c) { skip('water_or_unread'); continue }
      if (c.log) { const s = SPECIES_OF(c.name); if (s) species[s] = (species[s] ?? 0) + 1; skip('tree'); continue }
      if (c.name !== 'grass_block') { skip('not_grass'); continue }
      if (!c.open) { skip('covered'); continue }
      if (cells.has(`${x},${c.y},${z}`) || cells.has(`${x},${c.y + 1},${z}`)) { skip('record'); continue }
      let edge = false
      for (let dx = -C.edge; dx <= C.edge && !edge; dx++) for (let dz = -C.edge; dz <= C.edge && !edge; dz++) if (blocked(x + dx, z + dz)) edge = true
      if (edge) { skip('edge'); continue }
      if (worked(x, z)) { skip('worked'); continue }
      let flat = true, wet = false
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = g(x + dx, z + dz)
        if (!q) { wet = true; break }
        if (Math.abs(q.y - c.y) > 1) flat = false
      }
      if (wet) { skip('water_beside'); continue }
      if (!flat) { skip('slope'); continue }
      elig.push([x, z, c.y])
    }
  }
  // the trees standing near: a column count of logs at ground level over the whole band box (+ the grove log radius)
  for (let x = home.x - R; x <= home.x + R; x++) for (let z = home.z - R; z <= home.z + R; z++) {
    if (dh(x, z) <= band.rMax) continue
    const c = g(x, z); if (c?.log) { const s = SPECIES_OF(c.name); if (s) species[s] = (species[s] ?? 0) + 1 }
  }
  census.eligible = elig.length
  const logNear = (x, z, r) => { for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) { const q = g(x + dx, z + dz); if (q?.log) return true } return false }
  const top = Object.entries(species).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'spruce'
  const groveRole = GROVE_ROLE[top] ?? 'sapling3'
  const E = new Map(elig.map(([x, z, y]) => [k2(x, z), y]))
  const rand = rng((seed ^ fnv1a(`country@1|${band.id}`)) >>> 0)
  const order = elig.map(e => e).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  const out = [], used = new Set(), centres = []
  const far = (x, z, sep) => centres.every(([cx, cz]) => Math.max(Math.abs(cx - x), Math.abs(cz - z)) >= sep)
  const nGroves = Math.floor(elig.length / C.grovePer), nDrifts = Math.floor(elig.length / C.driftPer)
  // GROVES: the pattern round a centre (a ring of offsets C.groveGap apart, the centre first)
  const G = C.groveGap
  const pattern = [[0, 0], [G, 0], [0, G], [-G, 0], [0, -G], [G, G], [-G, -G]]
  for (const [x, z, y] of order) {
    // the groves take at most half the band's plantings (the drifts keep their share: Paper proof 11-09, a dense band's groves took all 60)
    if (census.groves >= nGroves || out.length >= Math.floor(C.plantMax / 2)) break
    if (!far(x, z, C.groveSep) || logNear(x, z, C.groveLogR)) continue
    const pts = []
    for (const [dx, dz] of pattern) {
      if (pts.length >= C.groveMax) break
      const px = x + dx, pz = z + dz, py = E.get(k2(px, pz))
      if (py == null || used.has(k2(px, pz))) continue
      if (pts.some(([qx, , qz]) => Math.max(Math.abs(qx - px), Math.abs(qz - pz)) < G)) continue
      if (!roomAbove(read, px, py, pz, C.air)) continue
      pts.push([px, py + 1, pz])
    }
    if (pts.length < C.groveMin) continue
    centres.push([x, z])
    census.groves++
    for (const p of pts) { out.push({ at: p, role: groveRole, el: 'grove' }); used.add(k2(p[0], p[2])); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) used.add(k2(p[0] + dx, p[2] + dz)) }
    census.saplings += pts.length
  }
  // DRIFTS: one role a drift, its flowers within C.driftR of the centre on eligible columns
  for (const [x, z] of order) {
    if (census.drifts >= nDrifts || out.length >= C.plantMax) break
    if (used.has(k2(x, z)) || !far(x, z, C.driftSep)) continue
    const role = `flower${census.drifts % 4}`
    const pts = []
    const ring = []
    for (let dx = -C.driftR; dx <= C.driftR; dx++) for (let dz = -C.driftR; dz <= C.driftR; dz++) ring.push([dx, dz])
    ring.sort((a, b) => (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1])) || a[0] - b[0] || a[1] - b[1])
    for (const [dx, dz] of ring) {
      if (pts.length >= C.driftMax) break
      const px = x + dx, pz = z + dz, py = E.get(k2(px, pz))
      if (py == null || used.has(k2(px, pz))) continue
      // a sparse drift: never two flowers 4-beside on the diagonal pattern's off cells (a natural look, not a carpet)
      if (((px + pz) & 1) !== ((x + z) & 1)) continue
      pts.push([px, py + 1, pz])
    }
    if (pts.length < C.driftMin) continue
    centres.push([x, z])
    census.drifts++
    for (const p of pts) { out.push({ at: p, role, el: 'drift' }); used.add(k2(p[0], p[2])) }
    census.flowers += pts.length
  }
  const cellsOut = [], segments = []
  out.slice(0, C.plantMax).forEach((c, i) => {
    const seg = `C-P${Math.floor(i / C.segCells)}`
    if (!segments.some(s => s.seg === seg)) segments.push({ seg, deps: [] })
    cellsOut.push({ at: c.at, role: c.role, seg, plant: c.el })
  })
  return { cells: cellsOut, segments, census }
}

/**
 * A SITED BAND AS THE COUNTRY'S RECORD -> record | null. Pure. siteStage's band record (`rec`, or null when the band's earthwork found
 * nothing) re-labelled as the country chain's (plot, blueprint, stageId, `country` census), with the plantings appended as their own
 * segments. Null when neither has anything.
 */
export function countryRecord (rec, plant, { stage, home, now = Date.now(), builders = COUNTRY.builders } = {}) {
  const pc = plant?.cells ?? []
  if (!rec && !pc.length) return null
  const base = rec ?? { v: 1, cells: [], clear: [], cut: [], replant: [], segments: [], zones: [], pillars: 0, pits: 0, skipped: {}, bom: { earth: 0 }, sitedAt: now, home: home ? { x: home.x, y: home.y, z: home.z } : null }
  const segs = new Set((base.segments ?? []).map(s => s.seg))
  return {
    ...base,
    blueprint: COUNTRY_BLUEPRINT,
    plot: COUNTRY_PLOT,
    builders_max: builders,
    structure_complete: false,
    stage: stage?.k ?? null,
    stageId: stage?.id ?? null,
    r: Math.max(Number(base.r) || 0, stage?.rMax ?? 0, stage?.upto ?? 0),
    cells: [...(base.cells ?? []), ...pc],
    segments: [...(base.segments ?? []), ...(plant?.segments ?? []).filter(s => !segs.has(s.seg))],
    country: { stage: stage?.id ?? null, rMin: stage?.rMin ?? null, rMax: stage?.rMax ?? null, plant: plant?.census ?? null },
  }
}
/** A band with nothing to do, published complete (the cursor moves on; countryNext reads it). Pure. */
export function countryNothing ({ stage, home, now = Date.now(), by = '?', skipped = {} } = {}) {
  return { v: 1, blueprint: COUNTRY_BLUEPRINT, plot: COUNTRY_PLOT, home: home ? { x: home.x, y: home.y, z: home.z } : null, state: 'nothing', structure_complete: true,
    completeAt: now, cells: [], clear: [], cut: [], replant: [], segments: [], zones: [], pillars: 0, pits: 0, skipped, sitedBy: by, stage: stage?.k ?? null, stageId: stage?.id ?? null, builders_max: COUNTRY.builders }
}
/** The planting cells this record still owes (open: not done by `done`). Pure. */
export const plantsOpen = (rec, done = () => false) => (rec?.cells ?? []).filter(c => c?.plant && !done(c)).length
/** One row's detail fields for the lane decision (`_grounds_lane`). Pure. */
export const laneDetail = ({ lane, why, role, helper, demand }) => `lane=${lane} why=${why} role=${role}${helper ? ` crew=${helper}` : ''} country=${demand ?? '-'}`
