// THE TOWN TREE FARM: the blueprint builder's first blueprint. A grid of sapling plots next to town, planted from the
// bag, replanted after the fleet's ordinary wood gathering harvests it.
//
// WHY (owner 10-05): wood is the base input and the forest is being consumed -- median distance to a successful wood
// gather rose 66 -> 80 blocks in four days; fresh worlds buy about a week (fresh-worlds-buy-one-week). Meanwhile the
// fleet holds thousands of saplings with no use and the composter makes bone meal. A farm puts trees where the bots
// already are.
//
// WHAT IS MEASURED, NOT ASSUMED (sandbox rig 09-27, Paper sandbox 10-05; docs/reports/blueprint-builder-design-2026-10-05.md):
// - clearance: oak 5 air blocks above, birch 6 (skills.mjs SAPLING_CLEARANCE); the room is vertical (a 1x1 column grows).
// - growth needs light >= 9 above the sapling (wiki) and random ticks, which only fire within simulation distance of a
//   player: a farm next to town ticks while bots are at town and pauses when nobody is near (the read reports it).
// - spacing, logs per tree and growth time on Paper: see FARM_SPACING below.
//
// DOES NOT FIGHT THE WOOD GATHER: the farm never chops a standing tree. A bot's ordinary `gather <log>` finds farm
// trees first because they are the nearest logs to town; the farm's own visit only (1) restores lost soil, (2) clears
// LEFTOVER logs from a plot's column (a gather that took the reachable bottom of a trunk leaves the top floating, and a
// floating log blocks the next sapling's clearance for ever), (3) replants, (4) places growth torches if it carries
// them, and (5) -- only with TREEFARM_BONEMEAL on, which is OFF by default and not yet an owner decision -- bone meals
// the saplings.

import { placeAt, cellKey, keyOf, REPLACEABLE, solid, passable, isLiquid, materialPlan } from './blueprint.mjs'

// ---- the blueprint --------------------------------------------------------------------------------------------------

export const FARM_BLUEPRINT = 'treefarm'
export const FARM_VERSION = 1
/** Plots per side (FARM_GRID x FARM_GRID) and the trunk-to-trunk spacing. Spacing 4 keeps every neighbour's leaves
 *  (radius 2) out of a plot's column and leaves a 3-wide walkway; measured on Paper (design doc, growth table). */
export const FARM_GRID = 3
export const FARM_SPACING = 4
/** The farm is accepted with at least this many usable plots (terrain may cost a few). */
export const MIN_PLOTS = 6
/** Clear AIR cells required above a plot, at acceptance and before every planting: birch needs 6, oak 5 (measured,
 *  skills.mjs SAPLING_CLEARANCE), one more for margin -- so every farm species fits every ready plot. */
export const CLEAR_ABOVE = 7
/** A plot's cell may sit this far above or below the anchor's (no levelling: the farm follows gentle terrain). */
export const PLOT_DY = 2
/** Farm cells keep this horizontal distance from home (bots idle there) ... */
export const FARM_HOME_CLEARANCE = 6
/** ... and every plot is within this (townDistance) of home, so a gather from town reaches it (gather maxDistance 32). */
export const FARM_MAX_DIST = 30
/** Anchors (the grid's centre) searched on these rings around home. */
export const FARM_RING_MIN = 9
export const FARM_RING_MAX = 22
/** No container, station or the composter within this of a plot or torch (a lid opens, a stand stays free). */
export const FARM_CONTAINER_DISTANCE = 3
/** Saplings the farm plants, in preference order: birch first (a straight 5-7 log trunk, no branches; clearance 6). */
export const FARM_SPECIES = ['birch_sapling', 'oak_sapling']
export const PLANTABLE_SOIL = new Set(['dirt', 'grass_block', 'coarse_dirt', 'podzol', 'rooted_dirt', 'moss_block', 'mud'])
const CONTAINER = /^(chest|trapped_chest|ender_chest|barrel|hopper|dropper|dispenser|furnace|blast_furnace|smoker|brewing_stand|composter|crafting_table|(\w+_)?shulker_box)$/
const isLog = n => typeof n === 'string' && /_log$/.test(n)
const isSaplingName = n => typeof n === 'string' && /_sapling$/.test(n)
const isLeaves = n => typeof n === 'string' && /_leaves$/.test(n)

/** The grid's relative plot offsets, centred on the anchor (FARM_GRID odd or even: offsets stay integers). Pure. */
export function plotOffsets (grid = FARM_GRID, spacing = FARM_SPACING) {
  const out = []
  const half = (grid - 1) * spacing / 2
  for (let i = 0; i < grid; i++) for (let j = 0; j < grid; j++) out.push({ dx: Math.round(i * spacing - half), dy: 0, dz: Math.round(j * spacing - half) })
  return out
}
/** Growth torches: the centre of every 2x2 group of plots (manhattan 5 from each sapling's top: light 14-5 = 9). Pure. */
export function torchOffsets (grid = FARM_GRID, spacing = FARM_SPACING) {
  const out = []
  const half = (grid - 1) * spacing / 2
  for (let i = 0; i + 1 < grid; i++) for (let j = 0; j + 1 < grid; j++) out.push({ dx: Math.round(i * spacing - half + spacing / 2), dy: 0, dz: Math.round(j * spacing - half + spacing / 2) })
  return out
}

/** The surface cell of a column: the highest replaceable cell over a solid floor within `dy` of y0 -> {x,y,z} | null | 'unknown'. */
function surfaceAt (read, x, z, y0, dy) {
  for (let y = y0 + dy; y >= y0 - dy; y--) {
    const c = read(x, y, z), f = read(x, y - 1, z)
    if (!c || !f) return 'unknown'
    if (REPLACEABLE.has(c.name) && solid(f)) return { x, y, z }
  }
  return null
}

/**
 * WHY THIS CELL CANNOT BE A PLOT -> reason | null. Pure.
 *   read(x,y,z) -> { name, boundingBox } | null (unknown)
 *   plot  the cell the sapling goes into; its soil is the cell below
 * Plantable soil, a replaceable cell, CLEAR_ABOVE passable cells above it (air: leaves are refused at acceptance),
 * no liquid within 1 at the cell or soil level, no
 * container/station/composter within FARM_CONTAINER_DISTANCE, and not reserved by another town structure.
 */
export function plotRefusal (read, plot, { reserved = null } = {}) {
  const cell = read(plot.x, plot.y, plot.z), soil = read(plot.x, plot.y - 1, plot.z)
  if (!cell || !soil) return 'unknown'
  if (reserved && reserved(plot)) return 'reserved by another town structure'
  if (!PLANTABLE_SOIL.has(soil.name)) return `soil is ${soil.name}`
  if (!REPLACEABLE.has(cell.name)) return `cell is ${cell.name}`
  for (let k = 1; k <= CLEAR_ABOVE; k++) {
    const b = read(plot.x, plot.y + k, plot.z)
    if (!b) return 'unknown'
    if (b.name !== 'air' && b.name !== 'cave_air') return `${b.name} ${k} above`
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const dy of [0, -1]) {
    const b = read(plot.x + dx, plot.y + dy, plot.z + dz)
    if (!b) return 'unknown'
    if (isLiquid(b) || b.waterlogged) return `${b.name} beside`
  }
  const R = FARM_CONTAINER_DISTANCE
  for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) for (let dy = -1; dy <= 2; dy++) {
    if (Math.hypot(dx, dz) > R) continue
    const b = read(plot.x + dx, plot.y + dy, plot.z + dz)
    if (!b) return 'unknown'
    if (CONTAINER.test(b.name ?? '')) return `${b.name} within ${R}`
  }
  return null
}

/** Horizontal distance from home (the farm's rule) and the 3-D town distance gather's search uses. */
const flat = (home, p) => Math.hypot(p.x - home.x, p.z - home.z)
const townDist = (home, p) => Math.hypot(p.x - home.x, p.y - Math.floor(home.y ?? p.y), p.z - home.z)

/**
 * FIT THE FARM AT AN ANCHOR -> { record, why }. Pure. Every plot offset is placed at the anchor; each plot's cell is
 * its column's surface within PLOT_DY of the anchor; plots that pass plotRefusal (and the home/distance/avoid rules)
 * are kept; the farm is accepted with at least MIN_PLOTS. Torches are kept where their column has a surface on solid
 * ground that is not a plot's walkway-critical cell. ANY unknown read returns why='unknown' (decide later).
 *   avoid  [{ x, z, r }] other town sites (the composter's, a well cap): no farm cell within r horizontally
 */
export function fitFarm ({ read, anchor, home, avoid = [], reserved = null, grid = FARM_GRID, spacing = FARM_SPACING } = {}) {
  if (typeof read !== 'function' || !anchor || !home) return { record: null, why: 'no anchor' }
  const near = p => (Array.isArray(avoid) ? avoid : []).find(a => a && Number.isFinite(a.x) && flat(a, p) < (Number.isFinite(a.r) ? a.r : FARM_CONTAINER_DISTANCE))
  const plots = [], refused = {}
  for (const off of placeAt(plotOffsets(grid, spacing), anchor)) {
    const s = surfaceAt(read, off.x, off.z, anchor.y, PLOT_DY)
    if (s === 'unknown') return { record: null, why: 'unknown' }
    if (!s) { refused.no_surface = (refused.no_surface ?? 0) + 1; continue }
    if (flat(home, s) < FARM_HOME_CLEARANCE) { refused.home = (refused.home ?? 0) + 1; continue }
    if (townDist(home, s) > FARM_MAX_DIST) { refused.far = (refused.far ?? 0) + 1; continue }
    const a = near(s)
    if (a) { refused[a.what ?? 'avoid'] = (refused[a.what ?? 'avoid'] ?? 0) + 1; continue }
    const why = plotRefusal(read, s, { reserved })
    if (why === 'unknown') return { record: null, why: 'unknown' }
    if (why) { const k = why.split(' ')[0]; refused[k] = (refused[k] ?? 0) + 1; continue }
    plots.push(s)
  }
  if (plots.length < MIN_PLOTS) return { record: null, why: `${plots.length} usable plots (need ${MIN_PLOTS}): ${Object.entries(refused).map(([k, v]) => `${k}=${v}`).join(' ')}` }
  const plotKeys = new Set(plots.map(keyOf))
  const torches = []
  for (const off of placeAt(torchOffsets(grid, spacing), anchor)) {
    const s = surfaceAt(read, off.x, off.z, anchor.y, PLOT_DY)
    if (s === 'unknown') return { record: null, why: 'unknown' }
    if (!s || plotKeys.has(keyOf(s)) || near(s) || flat(home, s) < FARM_HOME_CLEARANCE) continue
    const floor = read(s.x, s.y - 1, s.z)
    if (!floor || !solid(floor) || CONTAINER.test(floor.name ?? '')) continue
    torches.push(s)
  }
  const cells = [...plots.map(p => ({ ...p, role: 'plot' })), ...torches.map(t => ({ ...t, role: 'torch' }))]
  return { record: { blueprint: FARM_BLUEPRINT, version: FARM_VERSION, anchor: { x: anchor.x, y: anchor.y, z: anchor.z }, grid, spacing, cells }, why: null }
}

/** The anchor spiral: rings FARM_RING_MIN..FARM_RING_MAX around home, each ring from east in angle order. Pure. */
export function farmSpiral (home) {
  const out = []
  for (let r = FARM_RING_MIN; r <= FARM_RING_MAX; r++) {
    const ring = []
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) ring.push([dx, dz])
    ring.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]) || a[0] - b[0] || a[1] - b[1])
    for (const [dx, dz] of ring) out.push({ x: home.x + dx, z: home.z + dz })
  }
  return out
}

/**
 * THE TOWN'S FARM -> { record, why }. Pure: a function of home and the world, so every bot computes the same farm.
 * Walks the spiral; the anchor's level is its column's surface near home.y; the first anchor that fits wins (the most
 * plots wins among the first FIT_WINDOW fits, so a 6-plot fit does not beat a 9-plot one a ring later). An unknown
 * read anywhere returns no farm (an unloaded chunk must not make two bots disagree).
 */
export const FIT_WINDOW = 24
export function canonicalFarm ({ home, read, avoid = [], reserved = null } = {}) {
  if (!home || typeof read !== 'function') return { record: null, why: 'no home' }
  const hy = Math.floor(home.y ?? 64)
  let best = null, seen = 0, lastWhy = 'no anchor tried'
  for (const a of farmSpiral(home)) {
    const s = surfaceAt(read, a.x, a.z, hy, 6)
    if (s === 'unknown') return { record: null, why: `unknown cell near ${a.x},${hy},${a.z}` }
    if (!s) continue
    const fit = fitFarm({ read, anchor: s, home, avoid, reserved })
    if (fit.why === 'unknown') return { record: null, why: `unknown cell near ${a.x},${s.y},${a.z}` }
    if (!fit.record) { lastWhy = fit.why; continue }
    const n = fit.record.cells.filter(c => c.role === 'plot').length
    if (!best || n > best.n) best = { ...fit, n }
    if (n === FARM_GRID * FARM_GRID || ++seen >= FIT_WINDOW) break
  }
  if (!best) return { record: null, why: `no farm site within ${FARM_RING_MAX} of home (last: ${lastWhy})` }
  return { record: best.record, why: null }
}

// ---- the farm, read ---------------------------------------------------------------------------------------------------

export const plotsOf = record => (record?.cells ?? []).filter(c => c.role === 'plot')
export const torchesOf = record => (record?.cells ?? []).filter(c => c.role === 'torch')

/**
 * WHAT IS A PLOT NOW -> { state, logs?, species? }. Pure.
 *   tree        a log stands in the plot cell (grown; the wood gather's to harvest)
 *   sapling     a sapling is growing
 *   soil_lost   the soil cell is open (dug or never there): dirt goes back
 *   soil_foreign  something else replaced the soil (quarantined: never dug by the farm)
 *   cell_foreign  a block (not ours) sits in the plot cell
 *   logs_above  the cell is open but logs float in the column (a partial harvest): `logs` are the cells to clear
 *   leaves_above  leaves still in the column: they decay once no log is near; wait
 *   column_foreign  some other solid in the column
 *   ready       plantable now: CLEAR_ABOVE air cells, so every farm species fits (`species`)
 *   unknown     not loaded
 */
export function plotState (read, plot) {
  const cell = read(plot.x, plot.y, plot.z), soil = read(plot.x, plot.y - 1, plot.z)
  if (!cell || !soil) return { state: 'unknown' }
  if (isLog(cell.name)) return { state: 'tree' }
  if (isSaplingName(cell.name)) return { state: 'sapling', species: cell.name }
  if (!PLANTABLE_SOIL.has(soil.name)) return REPLACEABLE.has(soil.name) ? { state: 'soil_lost' } : { state: 'soil_foreign', what: soil.name }
  if (!REPLACEABLE.has(cell.name)) return { state: 'cell_foreign', what: cell.name }
  const logs = []
  let leaves = false, foreign = null
  for (let k = 1; k <= CLEAR_ABOVE; k++) {
    const b = read(plot.x, plot.y + k, plot.z)
    if (!b) return { state: 'unknown' }
    if (isLog(b.name)) { logs.push({ x: plot.x, y: plot.y + k, z: plot.z }); continue }
    if (isLeaves(b.name)) { leaves = true; continue }
    if (b.name === 'air' || b.name === 'cave_air') continue
    if (!foreign) foreign = b.name
  }
  if (logs.length) return { state: 'logs_above', logs }
  if (foreign) return { state: 'column_foreign', what: foreign }
  if (leaves) return { state: 'leaves_above' }
  return { state: 'ready', species: [...FARM_SPECIES] }
}

/**
 * IS THE RECORDED FARM STILL A FARM? -> reason | 'unknown' | null. Pure. It is while at least MIN_PLOTS of its plots are
 * not taken over by something foreign (a tree, a sapling, a ready plot, leftover logs, leaves and lost soil all count:
 * the farm repairs those). A record of another blueprint or an older layout is refused, so the town starts a fresh
 * generation; unknown plots that could decide it defer.
 */
export function farmRecordRefusal (read, record) {
  if (!record || record.blueprint !== FARM_BLUEPRINT) return 'not a tree farm record'
  if (record.version !== FARM_VERSION) return `an older farm layout (v${record.version})`
  const plots = plotsOf(record)
  let viable = 0, unknown = 0
  for (const p of plots) {
    const s = plotState(read, p).state
    if (s === 'unknown') { unknown++; continue }
    if (!/foreign/.test(s)) viable++
  }
  if (viable >= MIN_PLOTS) return null
  if (viable + unknown >= MIN_PLOTS) return 'unknown'
  return `${viable} of ${plots.length} plots still usable`
}

/** A torch cell now -> 'done' | 'open' | 'blocked' | 'unknown'. Pure. */
export function torchState (read, t) {
  const b = read(t.x, t.y, t.z), f = read(t.x, t.y - 1, t.z)
  if (!b || !f) return 'unknown'
  if (b.name === 'torch') return 'done'
  if (REPLACEABLE.has(b.name) && solid(f)) return 'open'
  return 'blocked'
}

/** The bone meal arm. OFF unless TREEFARM_BONEMEAL says on: the owner has not decided bone meal (10-05). Pure. */
export function bonemealEnabled (env = {}) {
  const v = env?.TREEFARM_BONEMEAL
  return typeof v === 'string' && /^(1|true|yes|on)$/i.test(v.trim())
}
/** The farm itself, on unless TREEFARM_ENABLED says off (a kill switch for the canary pool's env). Pure. */
export function farmEnabled (env = {}) {
  const v = env?.TREEFARM_ENABLED
  if (v === undefined || v === null || v === '') return true
  return !/^(0|false|no|off)$/i.test(String(v).trim())
}

/** Mutations one visit may make: every one is a walk plus a server round trip. */
export const MAX_MUTATIONS_PER_VISIT = 14
/** A leftover log above this (relative to the plot cell) is out of a standing bot's dig reach (blueprint DIG_REACH): the
 *  plot is counted `logs_high` and left (a fancy oak's crown), never an action that fails on every visit. */
export const MAX_DIG_UP = 6
export const BONEMEAL_PER_VISIT = 6

/**
 * THE VISIT'S WORK, IN ORDER -> { actions: [...], counts, materials }. Pure.
 *   states  [{ plot, state, logs?, species? }] from plotState; torches [{ cell, state }] from torchState
 *   held    name -> count in the bag
 * Order: soil back first (a plot cannot be planted without it), then leftover logs out of the columns (lowest first:
 * each dig is reachable from the one below), then saplings, then torches (only those carried), then bone meal (arm on).
 * Each sapling is the most preferred species HELD (FARM_SPECIES order: birch while it lasts); nothing unheld is planted.
 */
export function tendPlan ({ states = [], torches = [], held = {}, bonemeal = false, max = MAX_MUTATIONS_PER_VISIT } = {}) {
  const left = { ...held }
  const actions = []
  const counts = {}
  for (const s of states) counts[s.state] = (counts[s.state] ?? 0) + 1
  for (const s of states) if (s.state === 'soil_lost' && (left.dirt ?? 0) > 0) { actions.push({ kind: 'place', cell: { x: s.plot.x, y: s.plot.y - 1, z: s.plot.z }, item: 'dirt', role: 'soil' }); left.dirt-- }
  for (const s of states) {
    if (s.state !== 'logs_above') continue
    const reachable = [...s.logs].sort((a, b) => a.y - b.y).filter(l => l.y - s.plot.y <= MAX_DIG_UP)
    if (reachable.length < s.logs.length) counts.logs_high = (counts.logs_high ?? 0) + 1
    for (const l of reachable) actions.push({ kind: 'dig', cell: l, role: 'leftover_log', plot: s.plot })
  }
  for (const s of states) {
    if (s.state !== 'ready') continue
    const sp = (s.species ?? []).filter(n => (left[n] ?? 0) > 0).sort((a, b) => FARM_SPECIES.indexOf(a) - FARM_SPECIES.indexOf(b))[0]
    if (!sp) continue
    left[sp]--
    actions.push({ kind: 'place', cell: { x: s.plot.x, y: s.plot.y, z: s.plot.z }, item: sp, role: 'plant' })
  }
  for (const t of torches) if (t.state === 'open' && (left.torch ?? 0) > 0) { actions.push({ kind: 'place', cell: t.cell, item: 'torch', role: 'torch' }); left.torch-- }
  if (bonemeal) {
    let n = 0
    for (const s of states) if (s.state === 'sapling' && (left.bone_meal ?? 0) > 0 && n < BONEMEAL_PER_VISIT) { actions.push({ kind: 'bonemeal', cell: { x: s.plot.x, y: s.plot.y, z: s.plot.z }, item: 'bone_meal', role: 'bonemeal' }); left.bone_meal--; n++ }
  }
  const ready = states.filter(s => s.state === 'ready')
  const materials = materialPlan(ready.map(s => ({ items: s.species?.length ? s.species : FARM_SPECIES })), held)
  return { actions: actions.slice(0, Math.max(0, max)), counts, materials }
}

/** Is there anything a visit would do? (the order's cheap test) Pure. */
export const tendWorthIt = plan => (plan?.actions ?? []).length > 0

// ---- reservations: the cells no other code may build in or dig ------------------------------------------------------

/**
 * THE FARM'S RESERVED CELLS AS A LOOKUP -> { soil:Set, column:Map(x,z -> [y0,y1]), torch:Set, box }. Pure.
 *   soil    every plot's soil cell and every torch's floor cell: never dug by a path, a gather or a wear_out
 *   column  every plot's cell and CLEAR_ABOVE above it: never built in by a path's scaffold or a placement (but walked
 *           through and harvested: a farm tree's logs are wood)
 *   torch   the torch cells: nothing else placed there
 *   box     the farm's horizontal extent + 2 (the planting obligation's no-plant zone, except on plots)
 */
export function farmIndex (record) {
  const soil = new Set(), column = new Map(), torch = new Set()
  let box = null
  for (const c of record?.cells ?? []) {
    if (c.role === 'plot') {
      soil.add(cellKey(c.x, c.y - 1, c.z))
      column.set(`${c.x},${c.z}`, [c.y, c.y + CLEAR_ABOVE])
    } else if (c.role === 'torch') {
      torch.add(keyOf(c)); soil.add(cellKey(c.x, c.y - 1, c.z))
    }
    box = box ? { x0: Math.min(box.x0, c.x), x1: Math.max(box.x1, c.x), z0: Math.min(box.z0, c.z), z1: Math.max(box.z1, c.z) } : { x0: c.x, x1: c.x, z0: c.z, z1: c.z }
  }
  if (box) box = { x0: box.x0 - 2, x1: box.x1 + 2, z0: box.z0 - 2, z1: box.z1 + 2 }
  return { soil, column, torch, box }
}
const EMPTY = { soil: new Set(), column: new Map(), torch: new Set(), box: null }
export const emptyFarmIndex = () => EMPTY

/** Is (x,y,z) inside a plot column (cell .. CLEAR_ABOVE above)? Pure. */
export function inPlotColumn (idx, x, y, z) {
  const c = idx?.column?.get(`${x},${z}`)
  return !!c && y >= c[0] && y <= c[1]
}
/** Is (x,y,z) a plot's own cell (where the sapling goes)? Pure. */
export const isPlotCell = (idx, x, y, z) => { const c = idx?.column?.get(`${x},${z}`); return !!c && y === c[0] }
/** Protected from digging (soil and torch floors)? Pure. */
export const farmNoDig = (idx, x, y, z) => !!idx?.soil?.has(cellKey(x, y, z))
/** Inside the farm's box (horizontal)? Pure. */
export const inFarmBox = (idx, x, z) => !!idx?.box && x >= idx.box.x0 && x <= idx.box.x1 && z >= idx.box.z0 && z <= idx.box.z1

/**
 * MAY `item` BE PLACED INTO (x,y,z)? -> reason | null. Pure. The one rule every placement path asks (place(), the
 * planting obligation, the composter's site): a plot column takes only the farm's saplings in its own cell; a torch
 * cell only a torch; a soil cell only dirt; anything else anywhere else.
 */
export function farmPlaceRefusal (idx, x, y, z, item = '') {
  if (!idx) return null
  if (inPlotColumn(idx, x, y, z)) {
    if (isPlotCell(idx, x, y, z) && FARM_SPECIES.includes(item)) return null
    return 'a tree-farm plot column'
  }
  if (idx.torch?.has(cellKey(x, y, z))) return item === 'torch' ? null : 'a tree-farm torch cell'
  if (idx.soil?.has(cellKey(x, y, z))) return item === 'dirt' ? null : 'a tree-farm soil cell'
  return null
}

/** pathfinder exclusionAreasPlace entry: no scaffold into a plot column or torch cell. Hot path: Map/Set lookups only. */
export function farmPlaceCost (idx, block) {
  const p = block?.position
  if (!p || !idx || (!idx.column.size && !idx.torch.size)) return 0
  return (inPlotColumn(idx, p.x, p.y, p.z) || idx.torch.has(cellKey(p.x, p.y, p.z))) ? 100 : 0
}
/** pathfinder exclusionAreasBreak entry: never dig a plot's soil or a torch's floor. */
export function farmBreakCost (idx, block) {
  const p = block?.position
  if (!p || !idx || !idx.soil.size) return 0
  return idx.soil.has(cellKey(p.x, p.y, p.z)) ? 100 : 0
}

// ---- the order ----------------------------------------------------------------------------------------------------------

export const TEND_COOLDOWN_MS = 5 * 60 * 1000
export const TEND_BACKOFF_MS = 20 * 60 * 1000
/** No farm fits near this town (a definitive search, not an unloaded cell): try again much later, not every visit. */
export const NO_SITE_BACKOFF_MS = 2 * 60 * 60 * 1000
/** Something else holds the farm (another bot's lease) or the bag changed: the next visit, not a fault. */
export const TEND_SOFT_FAILS = new Set(['farm_leased', 'farm_unknown'])
export const FARM_SCAN_MS = 30 * 1000
export const FARM_ORDERS = new Set(['tend_farm'])
const TOWN_RADIUS = 48
const lazy = v => (typeof v === 'function' ? v() : v)

/**
 * THE FARM'S TOWN ORDER -> { order, state }. Pure; cognitive.mjs supplies readings and keeps `state`.
 *   distHome   horizontal distance from home (cheap, first)
 *   plan       () -> tendPlan(...) | null   this bot's view of the farm's work (lazy, at most every FARM_SCAN_MS)
 *   saplings   how many allowed saplings the bag holds (a farm can only be FOUNDED by a bot that can plant it)
 *   farm       () -> 'present' | 'absent' | 'unknown'
 * Never the model's choice and never a trip: only at town, only when the visit has work, a cooldown charged when the
 * order is ISSUED.
 */
export function farmOrder ({ now = 0, distHome = Infinity, plan = null, state = {}, enabled = true } = {}) {
  const s = { ...state }
  const none = () => ({ order: null, state: s })
  if (!enabled) return none()
  if (!(distHome <= TOWN_RADIUS)) return none()
  if (now - (s.lastTendAt ?? -Infinity) < TEND_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return none()
  if (now - (s.lastScanAt ?? -Infinity) < FARM_SCAN_MS) return none()
  s.lastScanAt = now
  const p = lazy(plan)
  if (!p || !tendWorthIt(p)) return none()
  s.lastTendAt = now
  const k = {}
  for (const a of p.actions) k[a.role] = (k[a.role] ?? 0) + 1
  const what = Object.entries(k).map(([r, n]) => `${n} ${r}`).join(', ')
  return { order: { skill: 'tend_farm', args: {}, why: `at town; the town tree farm has work: ${what}` }, state: s }
}

/** After a tend ran -> the new state. A skip (no_effect), an interruption, a runner refusal or a soft failure costs nothing more than the cooldown; a fault backs off. */
export function farmOrderOutcome (skill, status, now = 0, state = {}, failClass = null, declined = new Set()) {
  const s = { ...state }
  if (!FARM_ORDERS.has(skill) || status === 'no_effect' || status === 'aborted' || declined.has(failClass) || TEND_SOFT_FAILS.has(failClass)) return s
  s.backoffUntil = status === 'success' ? 0 : now + (failClass === 'farm_no_site' ? NO_SITE_BACKOFF_MS : TEND_BACKOFF_MS)
  return s
}

// ---- the row the read counts --------------------------------------------------------------------------------------------

/**
 * THE _farm_tend ROW, key=value (the read parses fields, never prose); stop= before the plot census (cut at 300).
 *   planted / soil / cleared / torches / bonemeal   VERIFIED by a server block update at the cell (never the click)
 *   failed     mutations the server refused or never answered;  offplan  mutations at a cell not in the record (must be 0)
 *   lost       non-farm items the bag lost during the visit (must be 0)
 *   census     the plots as this visit read them before acting: tree, sapling, ready, logs_above, ...
 *   t0         the visit's start (epoch ms): with the row's own time, the span the read checks for two builders at once
 */
export function farmTendDetail ({ gen = 0, planted = 0, soil = 0, cleared = 0, torches = 0, bonemeal = 0, failed = 0, offplan = 0, lost = 0,
                                  lease = '-', stop = 'done', census = {}, species = {}, at = null, t0 = 0 } = {}) {
  const c = Object.entries(census).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(',') || '-'
  const sp = Object.entries(species).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(',') || '-'
  return (`gen=${gen} planted=${planted} soil=${soil} cleared=${cleared} torches=${torches} bonemeal=${bonemeal} failed=${failed} ` +
          `offplan=${offplan} lost=${lost} lease=${lease}${at ? ` at=${at.x},${at.y},${at.z}` : ''} t0=${Math.round(t0) || 0} ` +
          `stop=${String(stop).replace(/\s+/g, '_').slice(0, 80)} census=${c} species=${sp}`).slice(0, 300)
}

export { passable }
