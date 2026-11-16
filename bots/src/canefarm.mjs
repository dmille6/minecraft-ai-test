// CANEFARM-01: THE TOWN'S SUGAR CANE BED (OWNER 2026-11-04, enchantshop E1: "a dedicated cane bed like the tree farm"; ledger
// enchantshop-1104; design docs/reports/enchantshop-design-2026-11-04.md section 11 on main). The enchanting workshop's books need
// 138 sugar cane (45 shelves' and the table's books: 3 paper a book, 1 cane a paper) and the town has none: the 61 cane in the bags
// is the park's planting stock, which the workshop never spends. PURE: the switch, the siting, the record, the cane read, the
// harvest list, the due test, the rows. Nothing here touches a bot or a file. The visit is skills.mjs buildCaneFarm.
//
// THE PATTERN is the crop farm's (cropfarm.mjs, itself the tree farm's): a record sited once (shop.mjs PROJECTS, buildproj.mjs
// records and leases), built by buildrun.mjs runVisit (the cane PLACED on its cell), kept by UPKEEP (`due`, after every open project):
// the harvest and the replant. No water is ever placed (bucket.mjs is protected scope): the bed is sited on NATURAL water edges.
//
// VANILLA (SugarCaneBlock.canSurvive, 1.21): a cane block stands on cane, or on grass / dirt / sand (any #dirt or #sand block) with
// WATER (or frosted ice) in a cardinal cell beside that ground block, at its level. It grows to 3 tall by random ticks (age 0..15 per
// block, one new block at age 15), and breaking a cane block breaks every cane block above it (each drops one cane).
// THE HARVEST cuts the SECOND block (the bottom one stays, so it regrows: the owner's "harvested above the bottom block"): every
// block from the second up drops a cane; the bed is never re-planted for a harvest.
//
// THE LAYOUT: the bed's cells are ground blocks on a natural water edge (soil, a cardinal neighbour at the same level holding water),
// the cane on top (y + 1), two cells of air above it to grow into, and a STAND (a dry land cell beside it at the cane's level: its
// feet cell and its head cell open, solid ground under it, never another cane cell) from which a builder places and cuts. The best
// CLUSTER (at most CANE.cells cells within a CANE.span box), the most cells, then the nearest, wins. A cluster of fewer than
// CANE.minCells is no site.
//
// CANEFARM=off is the rollback (never offered; a sited record stays a reservation). On only in CANEFARM_POOLS (default 'showcase').

export const CANEFARM_PLOT = 'canefarm'
export const CANEFARM_BLUEPRINT = 'canefarm@1'
export const CANEFARM_BUILDERS = 1
export const CANE = Object.freeze({
  cells: 16,                // the bed's cane cells at most
  minCells: 6,              // fewer than this on one cluster: no site
  span: 12,                 // the cluster's box at most span x span (columns)
  rMin: 10, rMax: 96,       // the cells' distance from home (the nearest natural water edges on the showcase are ~62 out)
  headroom: 3,              // cells above the ground that must be air (the cane grows to 3)
  harvestMax: 16,           // cuts a visit
  townCap: 192,             // the town's sugar cane (chests): at or above, the harvest waits (three stacks)
  keep: 0,                  // cane the bag keeps after a visit beyond the open cells' planting (the rest is banked for paper)
  minFree: 3,               // free bag slots a harvest needs
})
/** The ground a cane block stands on (vanilla #dirt + #sand, as they occur at a water edge). */
export const CANE_SOIL = /^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|mycelium|moss_block|mud|muddy_mangrove_roots|sand|red_sand|suspicious_sand)$/
/** A plant a visit digs from an OPEN cane cell before planting (buildrun.mjs foreignKind's scaffold class): a small plant only. */
export const CANE_FOREIGN = /^(short_grass|tall_grass|fern|large_fern|dandelion|poppy|[a-z_]+_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|leaf_litter|wildflowers|pink_petals|short_dry_grass|tall_dry_grass|bush|dead_bush|snow)$/
/** The record's palette: a cane cell takes sugar_cane (its block reads as the item). */
export const CANE_PALETTE = Object.freeze({ cane: Object.freeze(['sugar_cane']) })

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const AIRN = n => n === 'air' || n === 'cave_air' || n === 'void_air'
const isWater = b => !!b && (nm(b) === 'water' || nm(b) === 'frosted_ice')
const k3 = (x, y, z) => `${x},${y},${z}`
const CARD = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/** THE SWITCH -> bool. CANEFARM=on|off; unset = on only in CANEFARM_POOLS (default 'showcase'). Pure. */
export function canefarmOn (env = process.env, pool = '') {
  const v = String(env?.CANEFARM ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  return String(env?.CANEFARM_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean).includes(String(pool ?? ''))
}

// ---- the siting ---------------------------------------------------------------------------------------------------------------

/**
 * ONE GROUND CELL -> { ok, why, cell?, stand?, clear? }. Pure over `read`. `g` [x, y, z] is the ground block; the cane goes at y + 1.
 *   ok: soil; a cardinal neighbour at y holds water; y + 1 open (air or a small plant: then listed as a clear), y + 2 and y + 3 air;
 *   a STAND: a cardinal neighbour at y + 1 whose feet and head cells are air, on solid dry ground, never water.
 */
export function caneCell (read, g, { isCane = () => false, standOk = () => true } = {}) {
  const [x, y, z] = g
  const gb = read(x, y, z)
  if (!gb) return { ok: false, why: 'unknown' }
  if (!CANE_SOIL.test(nm(gb))) return { ok: false, why: 'soil' }
  if (!CARD.some(([dx, dz]) => isWater(read(x + dx, y, z + dz)))) return { ok: false, why: 'dry' }
  const c = read(x, y + 1, z)
  if (!c) return { ok: false, why: 'unknown' }
  const cn = nm(c)
  const clear = []
  if (!AIRN(cn)) { if (!CANE_FOREIGN.test(cn)) return { ok: false, why: 'cover' }; clear.push({ at: [x, y + 1, z], kind: 'plant', name: cn }) }
  for (let k = 2; k <= CANE.headroom; k++) {
    const a = read(x, y + k, z)
    if (!a) return { ok: false, why: 'unknown' }
    if (!AIRN(nm(a))) return { ok: false, why: 'headroom' }
  }
  for (const [dx, dz] of CARD) {
    const sx = x + dx, sz = z + dz
    if (isCane(sx, sz) || !standOk(sx, sz)) continue
    const feet = read(sx, y + 1, sz), head = read(sx, y + 2, sz), floor = read(sx, y, sz)
    if (!feet || !head || !floor) continue
    if (AIRN(nm(feet)) && AIRN(nm(head)) && floor.boundingBox === 'block' && !isWater(floor) && !/^(lava|magma_block)$/.test(nm(floor))) return { ok: true, why: null, cell: [x, y + 1, z], stand: [sx, y + 1, sz], clear }
  }
  return { ok: false, why: 'no_stand' }
}

/**
 * THE CANDIDATES -> [{ g, cell, stand, clear }]: every ground cell on a natural water edge within rMin..rMax of home, off every
 * reservation (`blocked(x, z)` -> reason | null), with its cane and stand clear. Pure over `read`. `ground(x, z)` -> the ground's y
 * or null (the scan's surface: pathColumn stops at water, so the caller scans the water edge itself).
 */
export function caneCandidates (read, { home, blocked = () => null, yLo = null, yHi = null } = {}) {
  if (!home) return []
  const lo = yLo ?? Math.floor(home.y) - 16, hi = yHi ?? Math.floor(home.y) + 12
  const R = CANE.rMax, out = []
  for (let x = Math.floor(home.x) - R; x <= Math.floor(home.x) + R; x++) {
    for (let z = Math.floor(home.z) - R; z <= Math.floor(home.z) + R; z++) {
      const d = Math.hypot(x - home.x, z - home.z)
      if (d > R || Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) < CANE.rMin) continue
      // the surface: the highest solid block with air above it in the span (a water edge sits at the surface)
      let y = null
      for (let yy = hi; yy >= lo; yy--) {
        const b = read(x, yy, z)
        if (!b) break
        // a canopy is not the ground (a pond's bank under trees): leaves are passed; caneCell then wants air 3 above the soil
        if (AIRN(nm(b)) || CANE_FOREIGN.test(nm(b)) || /_leaves$/.test(nm(b))) continue
        y = yy
        break
      }
      if (y == null) continue
      const gb = read(x, y, z)
      if (!CANE_SOIL.test(nm(gb))) continue
      if (blocked(x, z)) continue
      const c = caneCell(read, [x, y, z], { standOk: (sx, sz) => !blocked(sx, sz) })
      if (!c.ok) continue
      out.push({ g: [x, y, z], cell: c.cell, stand: c.stand, clear: c.clear, d })
    }
  }
  return out
}

/**
 * THE BED -> { ok, why, cells: [{ cell, stand, clear }], box } | { ok: false }. Pure. The cluster: for every candidate as the box's
 * corner, the candidates within CANE.span of it (Chebyshev, both axes forward), at most CANE.cells nearest home; re-proved together
 * (a cane cell is never another's stand: caneCell with `isCane`); the most cells, then the nearest centre, wins.
 */
export function caneBed (read, cands = [], { home, blocked = () => null } = {}) {
  let best = null
  const S = CANE.span - 1
  const byX = [...cands].sort((a, b) => a.g[0] - b.g[0] || a.g[2] - b.g[2] || a.g[1] - b.g[1])
  for (const c0 of byX) {
    const inBox = byX.filter(c => c.g[0] >= c0.g[0] && c.g[0] <= c0.g[0] + S && Math.abs(c.g[2] - c0.g[2]) <= S && c.g[2] >= c0.g[2] - S)
    if (inBox.length < CANE.minCells) continue
    // one z window [zA, zA + S] containing c0's z, the one with the most cells
    let pick = []
    for (let zA = c0.g[2] - S; zA <= c0.g[2]; zA++) {
      const w = inBox.filter(c => c.g[2] >= zA && c.g[2] <= zA + S)
      if (w.length > pick.length) pick = w
    }
    if (pick.length < CANE.minCells) continue
    pick = pick.slice().sort((a, b) => a.d - b.d || a.g[0] - b.g[0] || a.g[2] - b.g[2]).slice(0, CANE.cells)
    const set = new Set(pick.map(c => `${c.g[0]},${c.g[2]}`))
    const isCane = (x, z) => set.has(`${x},${z}`)
    const cells = []
    for (const c of pick) {
      const r = caneCell(read, c.g, { isCane, standOk: (sx, sz) => !blocked(sx, sz) })
      if (r.ok) cells.push({ cell: r.cell, stand: r.stand, clear: r.clear })
    }
    if (cells.length < CANE.minCells) continue
    const xs = cells.flatMap(c => [c.cell[0], c.stand[0]]), zs = cells.flatMap(c => [c.cell[2], c.stand[2]])
    const box = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]
    const cd = Math.hypot((box[0] + box[2]) / 2 - home.x, (box[1] + box[3]) / 2 - home.z)
    if (!best || cells.length > best.cells.length || (cells.length === best.cells.length && cd < best.cd - 1e-9)) best = { cells, box, cd }
  }
  return best ? { ok: true, why: null, cells: best.cells, box: best.box } : { ok: false, why: cands.length ? 'no_cluster' : 'no_water_edge' }
}

/** THE SITING -> { ok, why, record, tried }. Pure over `read`: the candidates, the bed, the record. */
export function siteCaneFarm (read, { home, blocked = () => null, yLo = null, yHi = null } = {}) {
  if (!home || typeof read !== 'function') return { ok: false, why: 'no_home', record: null, tried: 0 }
  const cands = caneCandidates(read, { home, blocked, yLo, yHi })
  const bed = caneBed(read, cands, { home, blocked })
  if (!bed.ok) return { ok: false, why: `${bed.why} (${cands.length} edge cells)`, record: null, tried: cands.length }
  return { ok: true, why: null, tried: cands.length, record: caneRecord(bed, { home }) }
}

/** THE RECORD from a bed. Pure. One segment; a cane cell each, its stand, its listed clears. */
export function caneRecord (bed, { home }) {
  const cells = bed.cells.map(c => ({ at: c.cell.slice(), role: 'cane', seg: 'C' }))
  return {
    v: 1, blueprint: CANEFARM_BLUEPRINT, plot: CANEFARM_PLOT, home: { x: home.x, y: home.y, z: home.z },
    box: bed.box, cells, segments: [{ seg: 'C', deps: [] }], clear: bed.cells.flatMap(c => c.clear), replant: [],
    stands: bed.cells.map(c => ({ cell: c.cell.slice(), stand: c.stand.slice() })),
    counts: { cells: cells.length }, bom: { sugar_cane: cells.length }, builders_max: CANEFARM_BUILDERS,
  }
}

// ---- the bed, read --------------------------------------------------------------------------------------------------------------

export const caneCells = rec => (rec?.cells ?? []).filter(c => c.role === 'cane')
/**
 * WHAT A CANE CELL IS NOW -> 'ripe' (2+ tall: the harvest cuts the second block) | 'growing' (1 tall) | 'open' (air or a plant over
 * its soil, water still beside: cane goes in) | 'dry' (the water beside it is gone: never planted, named) | 'blocked' | 'unknown'.
 * Pure.
 */
export function caneState (read, cell) {
  const [x, y, z] = cell.at
  const b = read(x, y, z), s = read(x, y - 1, z)
  if (!b || !s) return 'unknown'
  if (nm(b) === 'sugar_cane') { const up = read(x, y + 1, z); if (!up) return 'unknown'; return nm(up) === 'sugar_cane' ? 'ripe' : 'growing' }
  if (!(AIRN(nm(b)) || CANE_FOREIGN.test(nm(b)))) return 'blocked'
  if (!CANE_SOIL.test(nm(s))) return 'blocked'
  if (!CARD.some(([dx, dz]) => isWater(read(x + dx, y - 1, z + dz)))) return 'dry'
  return 'open'
}
export function caneCensus (read, rec) {
  const out = {}
  for (const c of caneCells(rec)) { const s = caneState(read, c); out[s] = (out[s] ?? 0) + 1 }
  return out
}
/** THE CUT for a ripe cell -> [x, y + 1, z]: the SECOND block (the bottom one stays). Pure. */
export const cutCell = cell => [cell.at[0], cell.at[1] + 1, cell.at[2]]
/** THE HARVEST -> the ripe cells, at most `max`, nearest `from` first. Pure. */
export function caneHarvest (read, rec, { max = CANE.harvestMax, from = null } = {}) {
  const f = from ?? [rec?.home?.x ?? 0, 0, rec?.home?.z ?? 0]
  return caneCells(rec).filter(c => caneState(read, c) === 'ripe')
    .sort((a, b) => Math.hypot(a.at[0] - f[0], a.at[2] - f[2]) - Math.hypot(b.at[0] - f[0], b.at[2] - f[2]) || a.at[0] - b.at[0] || a.at[2] - b.at[2])
    .slice(0, Math.max(0, max))
}
/** The stand of a cane cell -> [x, y, z] | null (the record's). Pure. */
export const caneStand = (rec, cell) => (rec?.stands ?? []).find(s => Array.isArray(s?.cell) && s.cell.join(',') === cell.at.join(','))?.stand ?? null
/** The cane the bag needs for the open cells -> n. Pure. */
export function caneNeed (read, rec, held = 0) {
  const open = caneCells(rec).filter(c => caneState(read, c) === 'open').length
  return Math.max(0, open - (Number(held) || 0))
}
/**
 * IS THE BED DUE A VISIT? -> 'harvest' | 'replant' | null. Pure. A ripe cell (the town's cane under its cap, room in the bag); an open
 * cell while cane to plant it is in the bag or the town. Otherwise quiet (a cell with no cane anywhere waits: the bed is never
 * planted from the park's stock beyond the bag's own).
 */
export function caneDue (read, rec, { cane = 0, townCane = 0, freeSlots = 36 } = {}) {
  if ((Number(townCane) || 0) < CANE.townCap && freeSlots >= CANE.minFree && caneHarvest(read, rec, { max: 1 }).length) return 'harvest'
  if ((Number(cane) || 0) > 0 && caneCells(rec).some(c => caneState(read, c) === 'open')) return 'replant'
  return null
}
/** A cane cell the visit passes over now -> bool: planted (any height), dry (no water: never planted), or no cane to plant. Pure. */
export function caneAlsoDone (cell, read, { noCane = false } = {}) {
  if (cell?.role !== 'cane') return false
  const s = caneState(read, cell)
  return s === 'ripe' || s === 'growing' || s === 'dry' || (noCane && s === 'open')
}
/**
 * WHAT A VISIT BANKS -> { ownLeft, bank }. Pure. The bag's OWN cane (the park's planting stock: `own0` at the visit's start) is never
 * banked: the planting spends the town draw first, then the bag's own (`placed` - `drawn`); what is left of the bag's own stays;
 * everything above it (the harvest, an unplanted draw) is banked for the workshop's paper.
 */
export function caneBankable ({ own0 = 0, now = 0, drawn = 0, placed = 0 } = {}) {
  const fromOwn = Math.max(0, (Number(placed) || 0) - (Number(drawn) || 0))
  const ownLeft = Math.max(0, (Number(own0) || 0) - fromOwn)
  return { ownLeft, bank: Math.max(0, (Number(now) || 0) - ownLeft) }
}
/** The `_build op=harvest` row's fields (shop.mjs buildRowDetail). */
export const caneHarvestRow = ({ cell, block = 'sugar_cane', n = null }) => ({ project: CANEFARM_PLOT, op: 'harvest', cell, block, kind: 'cane', ...(n != null ? { n } : {}) })
/** `_canefarm_mode` detail. */
export const caneModeDetail = on => `on=${on ? 1 : 0} plot=${CANEFARM_PLOT} cells=${CANE.cells} min=${CANE.minCells} span=${CANE.span} r=${CANE.rMin}..${CANE.rMax} town_cap=${CANE.townCap} cut=second_block`
