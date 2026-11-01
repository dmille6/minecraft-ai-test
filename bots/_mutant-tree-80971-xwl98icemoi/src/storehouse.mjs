// STOREHOUSE-01: THE TOWN STOREHOUSE AS A PROJECT (owner: town plan 10-20 "storehouse-01 moved from conditional to planned"; 10-23
// Q1 "storehouse after shop-01 is KEPT"; B1 one shared workshop/storehouse per town; B2 palette stone bricks, planks, glass, copper
// trim; B5 a BUILDING = enclosed + roof + door + light inside). PURE: the switch, the palette, the geometry, the siting, the tidy.
// Nothing here touches a bot or a file; the visit is skills.mjs build_shop's ordinary blueprint visit (buildrun.mjs runVisit), the
// siting below in place of buildsite.mjs siteBlueprint's sector search.
//
// WHERE IT STANDS: on the town plan's OWN storehouse plot (townplan.mjs ring1: `store`, kind `storehouse`, the 9x9 pad u 7..15,
// v -4..4 beside the core plaza), AROUND the containers found-01 already placed in its section cells (one tier at s+1 along the
// three inner walls, chests on alternate cells). Nothing is torn down and no container is touched: the record's cells are the
// 7x7 walls (u 8..14, v -3..3, two high: s+1, s+2), the roof over them at s+3, and the lights; the containers' cells, the cells
// above them (a chest lid needs no solid above it) and their stands (the interior's middle 3x3) stay open. The town plan's
// greenfield rule made this possible: "every container sits at the same height s+1, so storehouse-01's pad can enclose them later".
//
// THE DOOR is an open doorway (owner Q2: an open doorway counts as a door) in a SIDE wall, at the side row's first gap cell
// (u 10, v -3*side: the side AWAY from the workshop strip, whose stations' stands are on the other side), so its inner cell is
// never a container cell and the walk in passes no chest; the plaza wall (u 8) gets windows and a torch instead. Why not the plan's
// door at u 8 on the plaza: its outside cell is one column from the core plaza, so a 2-wide path brush cannot reach it (the plaza
// and the wall columns are both refused) -- the paths project's leg ends at this doorway instead (`front`, `frontOpen`).
//
// WHAT A BUILDER DOES: the ordinary build visit -- draw the bill from the town chests (stone bricks, planks from the town's logs,
// cut copper, glass panes, torches), clear the litter the record names (bot crafting tables and dirt pillars standing in the wall
// line and the interior at siting), place the walls bottom-up, the eaves, the roof (the closer protocol), then the torches. A
// COMPLETE storehouse whose interior holds new litter (an idle crafting table in a stand) wants a tidy visit (`due`, after every
// open project), at most STORE_TIDY_TRIES per cell per bot.
//
// STOREHOUSE=off is the kill switch (the order never picks the project; no record is sited). On only in STOREHOUSE_POOLS (default
// 'showcase') until a fleet rollout.

import { rot, isSolid, isLiquid, replaceableCell, boxMeetsZones } from './townplan.mjs'
import { FOREIGN_CLEAR, STATION_CLEAR } from './buildrun.mjs'

export const STORE_PLOT = 'storehouse'
export const STORE_BLUEPRINT = 'storehouse@1'
export const STORE_BUILDERS = 2
/** THE SWITCH -> bool. STOREHOUSE=on|off; unset = on only in the pools STOREHOUSE_POOLS names (default 'showcase'). Pure. */
export function storehouseOn (env = process.env, pool = '') {
  const v = String(env?.STOREHOUSE ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  const pools = String(env?.STOREHOUSE_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes(String(pool))
}

/** THE PALETTE (owner B2): a stone-brick base course, a plank upper course with glass windows, copper corner posts, stone-brick eaves
 *  and a plank roof. Each role's first name the town stocks is drawn (shop.mjs billOf), so a town with no stone bricks builds the
 *  base and the eaves of cobblestone, one with no copper the corners of stone bricks. */
export const STORE_PALETTE = Object.freeze({
  base: Object.freeze(['stone_bricks', 'cobblestone']),
  step: Object.freeze(['stone_bricks', 'cobblestone']),
  upper: Object.freeze(['$planks']),
  window: Object.freeze(['glass_pane', '$upper']),
  corner: Object.freeze(['cut_copper', 'stone_bricks', 'cobblestone']),
  eave: Object.freeze(['stone_bricks', 'cobblestone']),
  roof: Object.freeze(['$planks']),
  light: Object.freeze(['torch']),
})

// ---- the geometry, in the town plan's own (u, v) frame (townplan.mjs rot: u out from the core toward the storehouse) ---------
export const STORE = Object.freeze({ u0: 8, u1: 14, v: 3, doorU: 10, pad: [7, -4, 15, 4] })
/** The 13 container cells of ring@1's store (townplan.mjs STORE_PERIMETER) as "u,v". */
const PERIMETER = new Set([[9, -2], [10, -2], [11, -2], [12, -2], [13, -2], [13, -1], [13, 0], [13, 1], [13, 2], [12, 2], [11, 2], [10, 2], [9, 2]].map(([u, v]) => `${u},${v}`))
/**
 * THE BLUEPRINT for a door side (`ds` = +1 or -1: the door's wall is v = 3 * ds) -> a buildsite.mjs blueprint (cells in the plan's
 * (u, v), y over the plan's s; segments; the proof's interior; the palette). Pure.
 */
export function storeBlueprint (ds = -1, steps = [1, -1]) {
  const d = ds < 0 ? -1 : 1
  const { u0, u1, v: V, doorU } = STORE
  const cells = []
  const add = (u, v, y, role, seg) => cells.push({ u, v, y, role, seg })
  const door = (u, v) => u === doorU && v === V * d
  const windowAt = (u, v) => (u === u0 && Math.abs(v) === 2) || (u === u1 && Math.abs(v) === 1) || (u === doorU && v === -V * d)
  const segOf = (u, v) => (u === u0 ? 'wall-F' : u === u1 ? 'wall-B' : v === -V ? 'wall-L' : 'wall-R')
  for (const y of [1, 2]) {
    for (let u = u0; u <= u1; u++) {
      for (let v = -V; v <= V; v++) {
        if (u !== u0 && u !== u1 && Math.abs(v) !== V) continue
        if (door(u, v)) continue
        const corner = (u === u0 || u === u1) && Math.abs(v) === V
        add(u, v, y, corner ? 'corner' : y === 1 ? 'base' : windowAt(u, v) ? 'window' : 'upper', segOf(u, v))
      }
    }
  }
  for (let u = u0; u <= u1; u++) for (let v = -V; v <= V; v++) add(u, v, 3, (u === u0 || u === u1 || Math.abs(v) === V) ? 'eave' : 'roof', (u === u0 || u === u1 || Math.abs(v) === V) ? 'roof-edge' : 'roof-inner')
  // THE STEPS (the house's `ring`, in two cells only): an eave goes onto a wall's TOP face at s+3, which an eye on the ground
  // (s+1 + 1.62) is below -- so a block at s+1 in a back corner of the pad ring is the stand the first eave is placed from; the
  // rest are placed sideways from the ground (`steps`: the back corners v = 4 * k whose ground holds one)
  for (const k of steps) add(STORE.u1 + 1, (STORE.v + 1) * (k < 0 ? -1 : 1), 1, 'step', 'ring')
  // the lights: wall torches at s+2 -- one on the plaza wall's inner face, one above each side row's back gap cell (never above a
  // container cell: its label's place, and a chest lid needs nothing solid there anyway)
  add(u0 + 1, 0, 2, 'light', 'fit-out')
  add(12, -2, 2, 'light', 'fit-out')
  add(12, 2, 2, 'light', 'fit-out')
  const interior = []
  for (let u = 10; u <= 12; u++) for (let v = -1; v <= 1; v++) interior.push([u, v, 1], [u, v, 2])
  interior.push([doorU, (V - 1) * d, 1], [doorU, (V - 1) * d, 2])
  return {
    id: STORE_BLUEPRINT, kind: 'storehouse', door: d,
    footprint: { u: u1 - u0 + 1, v: 2 * V + 1 },
    doorway: [[doorU, V * d, 1], [doorU, V * d, 2]],
    interior,
    palette: STORE_PALETTE,
    segments: [
      { seg: 'wall-F', layer: 1, deps: [] }, { seg: 'wall-B', layer: 1, deps: [] }, { seg: 'wall-L', layer: 1, deps: [] }, { seg: 'wall-R', layer: 1, deps: [] },
      { seg: 'ring', layer: 1, deps: [] },
      { seg: 'roof-edge', layer: 2, deps: ['ring', 'wall-F', 'wall-B', 'wall-L', 'wall-R'] },
      { seg: 'roof-inner', layer: 3, deps: ['roof-edge'] },
      { seg: 'fit-out', layer: 4, deps: ['roof-inner'] },
    ],
    cells,
  }
}
/** Every interior cell (u 9..13, v -2..2) at s+1 and s+2, plus the doorway -> [{ u, v, y, container }] (container: a ring@1
 *  container cell at s+1). Pure. */
export function storeInterior (ds = -1) {
  const d = ds < 0 ? -1 : 1
  const out = []
  for (let u = 9; u <= 13; u++) for (let v = -2; v <= 2; v++) for (const y of [1, 2]) out.push({ u, v, y, container: y === 1 && PERIMETER.has(`${u},${v}`) })
  out.push({ u: STORE.doorU, v: STORE.v * d, y: 1, container: false }, { u: STORE.doorU, v: STORE.v * d, y: 2, container: false })
  return out
}

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const k3 = (x, y, z) => `${x},${y},${z}`
const AIRN = n => n === 'air' || n === 'cave_air' || n === 'void_air'
/** A block the siting and the tidy may dig out of a storehouse cell: terrain and the fleet's scaffold (buildrun.mjs FOREIGN_CLEAR),
 *  a crafting table (STATION_CLEAR: it drops as the item). Never a container, a furnace, a log. Pure. */
export const storeLitter = n => FOREIGN_CLEAR.test(String(n ?? '')) || STATION_CLEAR.test(String(n ?? ''))
const LEAVES = /_leaves$/
/** A full floor a stand or a wall stands on (buildsite.mjs's solidFloor, without its import cycle). */
const FLOOR_BAD = /(_leaves$|_log$|_wood$|chest$|barrel|furnace|crafting_table|_slab$|_stairs$|_fence|_wall$|_pane$|glass|_door$|_trapdoor$|ladder|snow$)/
const floorOk = b => isSolid(b) && !isLiquid(b) && !FLOOR_BAD.test(nm(b))

/**
 * THE STORE PLOT this storehouse can stand on -> { ok, why, plot, side }. Pure. The plan's `store` plot must be a ring@1 storehouse
 * (kind `storehouse`, its 9x9 box where ring1 puts it for the plan's home and orientation): an annex, a cluster or an unplaced
 * store has no room for walls, and no storehouse is built there.
 */
export function storePlot (plan) {
  const home = plan?.home, o = plan?.orientation
  if (!home || !['E', 'S', 'W', 'N'].includes(o)) return { ok: false, why: 'no_plan' }
  const p = (plan.plots ?? []).find(q => q?.id === 'store')
  if (!p) return { ok: false, why: 'no_store_plot' }
  if (p.kind !== 'storehouse') return { ok: false, why: `store_${p.kind ?? 'unknown'}` }
  const [a, b] = [rot(o, STORE.pad[0], STORE.pad[1]), rot(o, STORE.pad[2], STORE.pad[3])]
  const box = [Math.min(a.dx, b.dx) + home.x, Math.min(a.dz, b.dz) + home.z, Math.max(a.dx, b.dx) + home.x, Math.max(a.dz, b.dz) + home.z]
  if (!Array.isArray(p.box) || p.box.join(',') !== box.join(',')) return { ok: false, why: 'store_shape' }
  if (!Number.isFinite(plan.s ?? p.y)) return { ok: false, why: 'no_level' }
  return { ok: true, why: 'ok', plot: p, side: (plan.workSide ?? 1) < 0 ? -1 : 1 }
}

/**
 * THE SITE (before the proof) -> { ok, why, detail?, site: { anchor, s, orient, clear, fill }, bp, door, front, frontOpen, inside }.
 * Pure over `read`.
 *   - the door's side: away from the workshop strip (ds = -side);
 *   - every record cell and every non-container interior cell (the doorway, the cells above the containers, a FREE container cell)
 *     holding a block: litter (storeLitter) or leaves is CLEARED, anything else refuses (a container, a station, a log, a liquid);
 *   - the columns ABOVE the roof up to s+6: litter and leaves cleared (a bot's pillar through the roof), anything else left;
 *   - the ground at s under every wall and interior stand column: a hole is FILLED (at most 3 deep) with cobblestone from the
 *     bottom up; a liquid or a deeper hole refuses;
 *   - no record cell in a protected zone.
 */
export function storeSite (read, plan, { zones = [] } = {}) {
  const sp = storePlot(plan)
  if (!sp.ok) return { ok: false, why: sp.why }
  const home = plan.home, o = plan.orientation, s = plan.s ?? sp.plot.y
  const ds = -sp.side
  const W = (u, v, y) => { const { dx, dz } = rot(o, u, v); return [home.x + dx, s + y, home.z + dz] }
  // the back corners whose ground at s is a floor take a step (at least one: the first eave's stand)
  const steps = [1, -1].filter(k => floorOk(read(...W(STORE.u1 + 1, (STORE.v + 1) * k, 0))))
  if (!steps.length) return { ok: false, why: 'no_step_ground' }
  const bp = storeBlueprint(ds, steps)
  const planCells = new Map((sp.plot.cells ?? []).filter(c => Array.isArray(c?.at)).map(c => [k3(...c.at), c]))
  const clear = [], fill = [], seen = new Set()
  const addClear = (at, kind) => { const k = k3(...at); if (seen.has(k)) return; seen.add(k); clear.push({ at, kind, name: nm(read(...at)) }) }
  // the record cells
  const cellsW = bp.cells.map(c => ({ ...c, at: W(c.u, c.v, c.y) }))
  if (boxMeetsZones(boxOf(cellsW.map(c => c.at)), zones)) return { ok: false, why: 'zone' }
  for (const c of cellsW) {
    const b = read(...c.at)
    if (!b) return { ok: false, why: 'unknown', detail: c.at.join(',') }
    const n = nm(b)
    if (AIRN(n) || replaceableCell(b)) continue
    if (isLiquid(b)) return { ok: false, why: 'liquid', detail: `${n}@${c.at.join(',')}` }
    if (storeLitter(n)) { addClear(c.at, 'scaffold'); continue }
    if (LEAVES.test(n)) { addClear(c.at, 'leaves'); continue }
    return { ok: false, why: 'cell_not_free', detail: `${n}@${c.at.join(',')}` }
  }
  // the interior (never a PLACED or RESERVED container: found-01's; a FREE container cell's litter is cleared for its chest)
  const inside = []
  for (const q of storeInterior(ds)) {
    const at = W(q.u, q.v, q.y)
    const pc = planCells.get(k3(...at))
    if (pc && pc.state !== 'free') continue
    inside.push(at)
    const b = read(...at)
    if (!b) return { ok: false, why: 'unknown', detail: at.join(',') }
    const n = nm(b)
    if (AIRN(n) || replaceableCell(b)) continue
    if (isLiquid(b)) return { ok: false, why: 'liquid', detail: `${n}@${at.join(',')}` }
    if (storeLitter(n)) { addClear(at, 'scaffold'); continue }
    if (LEAVES.test(n)) { addClear(at, 'leaves'); continue }
    // a plant or a torch on the floor is passable: a stand (and a free container cell) takes it as it is
    if (!isSolid(b)) continue
    return { ok: false, why: 'interior_blocked', detail: `${n}@${at.join(',')}` }
  }
  // the doorway's approach (the front column and its neighbours, at s+1 and s+2): litter there walls the doorway in
  // (and a pillar's blocks above them, to s+6: a column the paths' leg cannot level)
  for (const u of [STORE.doorU - 1, STORE.doorU, STORE.doorU + 1]) for (let y = 1; y <= 6; y++) {
    const at = W(u, (STORE.v + 1) * ds, y), b = read(...at), n = nm(b)
    if (!b) return { ok: false, why: 'unknown', detail: at.join(',') }
    if (storeLitter(n)) addClear(at, 'scaffold'); else if (LEAVES.test(n)) addClear(at, 'leaves')
    else if (isSolid(b) && u === STORE.doorU && y <= 2) return { ok: false, why: 'door_blocked', detail: `${n}@${at.join(',')}` }
  }
  // above the roof: a pillar's top
  for (let u = STORE.u0; u <= STORE.u1; u++) for (let v = -STORE.v; v <= STORE.v; v++) for (let y = 4; y <= 6; y++) {
    const at = W(u, v, y), n = nm(read(...at))
    if (storeLitter(n)) addClear(at, 'scaffold'); else if (LEAVES.test(n)) addClear(at, 'leaves')
  }
  // the ground: under every wall column and every interior stand (the middle 3x3 and the doorway's inner cell) and the doorway
  const cols = new Map()
  for (const c of cellsW) if (c.y === 1) cols.set(`${c.at[0]},${c.at[2]}`, [c.at[0], c.at[2]])
  for (const [u, v] of [...bp.interior.filter(q => q[2] === 1).map(q => [q[0], q[1]]), [STORE.doorU, STORE.v * ds]]) { const [x, , z] = W(u, v, 0); cols.set(`${x},${z}`, [x, z]) }
  for (const [x, z] of cols.values()) {
    if (floorOk(read(x, s, z))) continue
    let f = s - 1
    const holes = [[x, s, z]]
    for (; f >= s - 3; f--) { const b = read(x, f, z); if (!b) return { ok: false, why: 'unknown', detail: `${x},${f},${z}` }; if (floorOk(b)) break; holes.push([x, f, z]) }
    if (f < s - 3) return { ok: false, why: 'fill_too_deep', detail: `${x},${z}` }
    for (const at of holes) {
      const b = read(...at)
      if (isLiquid(b)) return { ok: false, why: 'liquid', detail: at.join(',') }
      if (AIRN(nm(b)) || replaceableCell(b)) continue
      if (storeLitter(nm(b)) || LEAVES.test(nm(b))) { addClear(at, LEAVES.test(nm(b)) ? 'leaves' : 'scaffold'); continue }
      return { ok: false, why: 'ground_blocked', detail: `${nm(b)}@${at.join(',')}` }
    }
    fill.push(...holes.sort((a, b) => a[1] - b[1]))
  }
  // the doorway's front: the column outside it (the paths' destination) and its two neighbours (the 2-wide brush's other half),
  // inside the plan's store box -- the paths' plan-plot refusal leaves them open for this record's leg only
  const front = [W(STORE.doorU, (STORE.v + 1) * ds, 0)].map(a => [a[0], a[2]])
  // (the pad ring v = 4 and the plot's +1 ring v = 5: townplan.mjs keepouts refuses a committed plot's box + 1)
  const frontOpen = [4, 5].flatMap(v => [STORE.doorU - 1, STORE.doorU, STORE.doorU + 1].map(u => W(u, v * ds, 0))).map(a => [a[0], a[2]])
  clear.sort((a, b) => a.at[1] - b.at[1])
  return { ok: true, why: 'ok', bp, site: { anchor: { x: home.x, z: home.z }, s, orient: o, clear, fill }, door: W(STORE.doorU, STORE.v * ds, 1), front, frontOpen, inside, plot: sp.plot }
}
function boxOf (ats) {
  const xs = ats.map(a => a[0]), ys = ats.map(a => a[1]), zs = ats.map(a => a[2])
  return [Math.min(...xs), Math.min(...ys), Math.min(...zs), Math.max(...xs), Math.max(...ys), Math.max(...zs)]
}
/** The stands' domain for a storehouse record: within STORE_DOMAIN of its walls' box (the interior, the pad ring, the plaza edge). */
export const STORE_DOMAIN = 4
export function storeDomain (rec) {
  const b = rec?.box
  if (!Array.isArray(b) || b.length !== 4) return () => false
  return (x, z) => x >= b[0] - STORE_DOMAIN && x <= b[2] + STORE_DOMAIN && z >= b[1] - STORE_DOMAIN && z <= b[3] + STORE_DOMAIN
}

/**
 * THE RECORD from a site and its proof (buildsite.mjs proveSite's { cells, segments, interior }) -> the record. Pure. The same
 * shape siteBlueprint writes (so every reader of a blueprint record -- the bill, the damage test, the footprint, the sapling box,
 * the siting zones -- reads it unchanged), plus the door, the paths' `front` / `frontOpen`, and `inside` (the interior cells the
 * tidy keeps clear).
 */
export function storeRecord (st, proof, { plan, stood = 0, now = 0 } = {}) {
  const cs = proof.cells
  const xs = cs.map(c => c.at[0]), zs = cs.map(c => c.at[2])
  const bom = {}
  for (const c of cs) { const b = c.role === 'fill' ? 'cobblestone' : (STORE_PALETTE[c.role] ?? ['?'])[0]; bom[b] = (bom[b] ?? 0) + 1 }
  return {
    v: 1, blueprint: STORE_BLUEPRINT, plot: STORE_PLOT, home: plan.home, sector: 'core', sector_source: 'plan', orient: st.site.orient,
    anchor: [st.site.anchor.x, st.site.anchor.z], box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], s: st.site.s, floor: st.site.s,
    earthwork: { fill: st.site.fill.length, cut: 0, litter: st.site.clear.length }, fill: st.site.fill,
    clear: st.site.clear.map(c => ({ at: c.at, kind: c.kind, name: c.name })), trees: [], felled: 0, replant: [],
    cells: cs, segments: proof.segments, interior: proof.interior, bom, builders_max: STORE_BUILDERS,
    door: st.door, front: st.front, frontOpen: st.frontOpen, inside: st.inside,
    // the showcase read's tidy space (shopread tidy_ok: box + 1, baseY .. the top + 2, never a record cell) -- the interior's litter
    baseY: st.site.s + 1,
    structure_complete: false, plan: { gen: plan.gen }, stood_seeds: stood, sitedAt: now,
  }
}

/**
 * THE TIDY of a storehouse record -> [{ at, kind: 'tidy', name }]: litter (storeLitter) standing in the record's `inside` cells now
 * (a crafting table an idle place put in a chest's stand, a scaffold block), at most STORE_TIDY_TRIES offers per cell per bot
 * (`tries` Map "x,y,z" -> n). Never a record cell (runVisit skips those too), never a container. Pure.
 */
export const STORE_TIDY_TRIES = 2
export function storeTidy (rec, read, tries = null) {
  const out = []
  if (rec?.blueprint !== STORE_BLUEPRINT) return out
  for (const at of rec.inside ?? []) {
    if (!Array.isArray(at) || at.length !== 3) continue
    if ((tries?.get?.(at.join(',')) ?? 0) >= STORE_TIDY_TRIES) continue
    const n = nm(read(...at))
    if (storeLitter(n)) out.push({ at, kind: 'tidy', name: n })
  }
  return out
}
