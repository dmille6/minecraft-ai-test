// THE BUILDING TIER'S SITING PLANNER (shop-01 step 1; design docs/reports/building-tier-2026-10-23.md sections 4.1-4.3, 4.6).
// Pure over a `read(x, y, z)` and the town's FROZEN plan: no bot, no world writes, no files. The same function a bot will run at
// a build visit is run OFFLINE on region copies (bots/scripts/buildsite-offline.mjs), so where the workshop goes is known, and
// reviewed, before any actuator code exists.
//
// WHAT IT DECIDES, IN ORDER (each refusal is named; the first one met is the candidate's reason):
//   1. the DOMAIN: every pad cell and every stand of the 1-cell ring around it at Chebyshev >= 22 and straight-line <= 44 from
//      home, inside the plan's PAVILION sector (the workshop replaces the pavilion as the first roofed build: section 4.3);
//      the doorway faces home (the front's outward normal is the cardinal nearest the door -> home direction);
//   2. the PLAN: no cell meets a plan cell or stand (keepouts NEVER), a committed plot's box + 1 (BOX), an uncommitted keep-out
//      plot's box + 1 or a path segment (SOFT); no protected zone; no plinth well cell or cap within 3; no tree-farm cell within
//      2; not the Z0 ziggurat footprint + 8 or the M0 shaft origin + 8 (TP 2-8);
//   3. the GROUND (B4): g0 = the most common ground level of the pad's columns (ties lower), the pad at s = g0 + 1; each column
//      within 3 of g0; fill <= 40 cells and cut <= 30; no liquid in the volume or the ring; nothing unknown; a cut column's
//      floor solid;
//   4. what STANDS IN THE VOLUME (pad columns, s .. s+3): a container, station or other bot furniture refuses the site; scaffold
//      litter (any other non-terrain, non-tree solid) is a fenced `scaffold` clear, at most 40; trees: every log of a tree
//      with a log in the volume is reachable (y <= s + 6, within 3 of the footprint), one trunk per tree (a 2x2 trunk refuses),
//      and each felled trunk gets a LEGAL REPLANT CELL (soil, 7 air above, 8-24 from the pad, outside every reservation, beside
//      a walkable cell) reserved before anything is felled;
//   5. THE PROOF: a construction sequence over the world as it will be after the clears and fills -- segment by segment in the
//      blueprint's dependency order, a cell is placed only when it has a SUPPORT (a solid neighbour now), a STAND (a cell a bot
//      walks to from home with every cell of this segment and before it in place; floors only from earlier segments), the face
//      within 4.5 of the eye, the eye on the face's open side, and a clear sight line; then the finished building's interior is
//      walkable from home through the open doorway. A cell with no step is `no_step` and the candidate fails.
//
// NOT PROVEN HERE (named; the actuator's and Paper's): the clear and fill sequence itself (dig reach and order), sapling
// clearance by species beyond 7 air, bodies, ghost blocks, the lease protocol, and the room test with a lit light.

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isSolid, isPassable, isLiquid, isTreeish, isFurniture, replaceableCell, sectorOf, keepouts, boxMeetsZones, rot } from './townplan.mjs'

const k3 = (x, y, z) => `${x},${y},${z}`
const k2 = (x, z) => `${x},${z}`
const nm = b => String(b?.name ?? '')

export const DOMAIN = Object.freeze({ cheb: 22, line: 44 })
export const EARTH = Object.freeze({ col: 3, fill: 40, cut: 30 })
export const LITTER_MAX = 40
export const REACH = 4.5
export const EYE = 1.62
export const TREE = Object.freeze({ above: 6, out: 3, maxLogs: 400 })
export const REPLANT = Object.freeze({ near: 8, far: 24, clear: 7 })
export const WALK_R = 48
export const SEED_R = 8
export const PROOF_TRIES = 40

const SOIL = new Set(['grass_block', 'dirt', 'podzol', 'coarse_dirt', 'rooted_dirt'])
const LOG = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_(log|wood)$/
const LEAVES = /_leaves$/
const STEM = /(_stem|_hyphae|^mushroom_stem|_mushroom_block)$/
// bot furniture and fittings that refuse a site when they stand in its volume (fitc.py's STATION list, plus the plan's FURNITURE)
const BUILT = /(chest|barrel|furnace|smoker|crafting_table|_bed$|lectern|composter|torch|lantern|ladder|_door$|_sign$|_hanging_sign$|rail$|_trapdoor$|_fence_gate$|hopper|anvil|bell|brewing_stand|_button$|lever|_pressure_plate$|campfire|_carpet$|_banner$|flower_pot)/
const SAPLING = { oak: 'oak_sapling', spruce: 'spruce_sapling', birch: 'birch_sapling', jungle: 'jungle_sapling', acacia: 'acacia_sapling', dark_oak: 'dark_oak_sapling', mangrove: 'mangrove_propagule', cherry: 'cherry_sapling', pale_oak: 'pale_oak_sapling' }
const NEEDS_2X2 = new Set(['dark_oak', 'pale_oak'])
// materials a bot places (scaffold, builds): never NATURAL ground, however they lie
const PLACED_MAT = /(_planks$|^cobblestone$|^mossy_cobblestone$|^stone_bricks$|^cobbled_deepslate$|glass|_wool$|_slab$|_stairs$|_wall$|_fence$|_concrete$|^bricks$|^smooth_stone$|copper|_bricks$|^stripped_)/
const AIR = Object.freeze({ name: 'air', boundingBox: 'empty' })

/** A NATURAL solid: a full block that is not a tree, leaves, liquid, bot furniture or a placed material. Pure. */
export const naturalSolid = b => isSolid(b) && !isTreeish(b) && !LEAVES.test(nm(b)) && !isLiquid(b) && !BUILT.test(nm(b)) && !isFurniture(b) && !PLACED_MAT.test(nm(b))
/**
 * THE BUILD'S GROUND -> the y of the top SUPPORTED natural solid of the column (a natural solid on a natural solid), within
 * home.y +- 12; null if a read in the span is unknown; undefined if there is none. Pure. Not townplan's groundY: towns are
 * littered with floating scaffold (board-d 10-25: cobblestone on leaves at 82, granite over air at 71, podzol over air at 67,
 * grass at 65 -- the ground), and any "top solid with room above" rule reads the litter as ground.
 */
export function groundOf (read, x, z, hy) {
  for (let y = hy + 12; y >= hy - 12; y--) {
    const b = read(x, y, z)
    if (!b) return null
    if (!naturalSolid(b)) continue
    const below = read(x, y - 1, z)
    if (!below) return null
    if (naturalSolid(below)) return y
  }
  return undefined
}
const SOLID = name => Object.freeze({ name, boundingBox: 'block' })
const ROLE_BOX = { light: 'empty' }

const here = fileURLToPath(new URL('.', import.meta.url))
/** A blueprint by id ('workshop@1') from bots/src/blueprints/. */
export function loadBlueprint (id) { return JSON.parse(fs.readFileSync(`${here}blueprints/${id}.json`, 'utf8')) }

/** The cardinal unit vector a local direction (du, dv) points to under an orientation. */
const dirOf = (orient, du, dv) => { const { dx, dz } = rot(orient, du, dv); return [Math.sign(dx), Math.sign(dz)] }
/** The world cells of a blueprint at (anchor x, z, pad level s, orientation). Pure. */
export function placeBlueprint (bp, anchor, s, orient) {
  return bp.cells.map(c => { const { dx, dz } = rot(orient, c.u, c.v); return { ...c, at: [anchor.x + dx, s + c.y, anchor.z + dz] } })
}
/** Local (u, v) -> world (x, z). */
const at2 = (anchor, orient, u, v) => { const { dx, dz } = rot(orient, u, v); return [anchor.x + dx, anchor.z + dz] }

/** The footprint columns and the 1-cell stand ring of a candidate -> { pad: [[x,z]], ring: [[x,z]] }. Pure. */
export function footprint (bp, anchor, orient) {
  const pad = [], ring = []
  const W = bp.footprint.u, D = bp.footprint.v
  for (let u = -1; u <= W; u++) for (let v = -1; v <= D; v++) {
    const inside = u >= 0 && u < W && v >= 0 && v < D
    ;(inside ? pad : ring).push(at2(anchor, orient, u, v))
  }
  return { pad, ring }
}

/** Every column at Chebyshev >= 22 and straight-line <= 44 of home. Pure. */
export const inDomain = (home, x, z) => Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) >= DOMAIN.cheb && Math.hypot(x - home.x, z - home.z) <= DOMAIN.line

/** Does the doorway face home? The front's outward normal must be the cardinal nearest the door -> home direction. Pure. */
export function facesHome (bp, home, anchor, orient) {
  const [nx, nz] = dirOf(orient, 0, -1)
  const [dx0, dz0] = at2(anchor, orient, bp.front.u, bp.front.v)
  const tx = home.x - dx0, tz = home.z - dz0
  const want = Math.abs(tx) >= Math.abs(tz) ? [Math.sign(tx), 0] : [0, Math.sign(tz)]
  return nx === want[0] && nz === want[1]
}

/**
 * THE RESERVATIONS a site must not meet -> a test object. Pure over the plan and the other records.
 *   ctx.zones  [{ box: [x0,y0,z0,x1,y1,z1] }]  (protected zones + avoid boxes)
 *   ctx.wells  [[x, y, z]]  plinth well cells and caps (every record's plan and its prev[] history)
 *   ctx.farm   [[x, z]]     tree-farm record cells
 *   ctx.z0     { centre: {x, z} } | null   ctx.m0 { origin: {x, z} } | null
 */
export function reservations (plan, ctx = {}) {
  const ko = keepouts(plan)
  const wells = (ctx.wells ?? []).map(c => [c[0], c[2]])
  const farm = new Set((ctx.farm ?? []).map(([x, z]) => k2(x, z)))
  const z0 = ctx.z0?.centre ? [ctx.z0.centre.x - 24 - 8, ctx.z0.centre.z - 24 - 8, ctx.z0.centre.x + 24 + 8, ctx.z0.centre.z + 24 + 8] : null
  const m0 = ctx.m0?.origin ? [ctx.m0.origin.x - 8, ctx.m0.origin.z - 8, ctx.m0.origin.x + 8, ctx.m0.origin.z + 8] : null
  const inB = (b, x, z) => b && x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]
  /** The reservation a column meets -> a reason or null (y range for the plan's NEVER cells). */
  const column = (x, z, y0, y1) => {
    for (let y = y0; y <= y1; y++) if (ko.never(x, y, z)) return 'plan_cell'
    if (ko.boxAt(x, z)) return 'plan_box'
    if (ko.softAt(x, z)) return 'plan_path_or_keepout'
    if (wells.some(([wx, wz]) => Math.max(Math.abs(wx - x), Math.abs(wz - z)) <= 3)) return 'well'
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (farm.has(k2(x + dx, z + dz))) return 'treefarm'
    if (inB(z0, x, z)) return 'z0_apron'
    if (inB(m0, x, z)) return 'm0_collar'
    return null
  }
  return { column, zones: ctx.zones ?? [] }
}

/** The connected logs of a tree from one log (26-neighbour, bounded) -> [[x, y, z]]. Pure. */
export function treeOf (read, start, max = TREE.maxLogs) {
  const seen = new Set([k3(...start)]), out = [start], q = [start]
  while (q.length && out.length <= max) {
    const [x, y, z] = q.shift()
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dy && !dz) continue
      const c = [x + dx, y + dy, z + dz], key = k3(...c)
      if (seen.has(key)) continue
      seen.add(key)
      if (LOG.test(nm(read(...c)))) { out.push(c); q.push(c) }
    }
  }
  return out
}
const speciesOf = name => (LOG.exec(name) ?? [])[1] ?? null

/** A FLOOR: a full solid that is not a tree, leaves, liquid or bot furniture -- natural or placed (blocks do not fall). Pure. */
export const solidFloor = b => isSolid(b) && !isTreeish(b) && !LEAVES.test(nm(b)) && !isLiquid(b) && !BUILT.test(nm(b)) && !isFurniture(b)

/**
 * ONE PAD COLUMN AT FLOOR LEVEL L (the pad at L + 1) -> { ok, why } | { ok, fill, plants, cut, litter, logs, leaves }. Pure.
 *   fill    the cells from the highest floor at or below L up to L that are not solid (at most EARTH.col deep)
 *   cut     NATURAL solids in the volume L+1 .. L+4 (at most EARTH.col per column); litter: every other floor there
 *   refused a liquid in L .. L+5, bot furniture in the volume, a mushroom, or an unknown read
 */
export function columnAt (read, x, z, L) {
  const out = { ok: true, fill: [], plants: [], cut: [], litter: [], logs: [], leaves: [] }
  let f = L
  while (f >= L - EARTH.col) { const b = read(x, f, z); if (!b) return { ok: false, why: 'unknown' }; if (solidFloor(b)) break; f-- }
  if (f < L - EARTH.col) return { ok: false, why: 'fill_too_deep' }
  for (let y = f + 1; y <= L; y++) {
    const b = read(x, y, z)
    if (isLiquid(b)) return { ok: false, why: 'liquid' }
    if (!replaceableCell(b)) out.plants.push([x, y, z])
    out.fill.push([x, y, z])
  }
  for (let y = L; y <= L + 5; y++) { const b = read(x, y, z); if (!b) return { ok: false, why: 'unknown' }; if (isLiquid(b)) return { ok: false, why: 'liquid' } }
  for (let y = L + 1; y <= L + 4; y++) {
    const b = read(x, y, z), n = nm(b)
    if (replaceableCell(b)) continue
    if (BUILT.test(n) || isFurniture(b)) return { ok: false, why: 'built_in_volume', detail: `${n}@${x},${y},${z}` }
    if (STEM.test(n)) return { ok: false, why: 'mushroom' }
    if (LOG.test(n)) { out.logs.push([x, y, z]); continue }
    if (LEAVES.test(n)) { out.leaves.push([x, y, z]); continue }
    // a passable plant (a flower, sugar cane, a sapling) or snow is not replaceable by a click: it is cleared, never litter
    if (isPassable(b) || n === 'snow' || !isSolid(b)) { out.plants.push([x, y, z]); continue }
    if (naturalSolid(b)) out.cut.push([x, y, z]); else out.litter.push([x, y, z])
  }
  if (out.cut.length > EARTH.col) return { ok: false, why: 'cut_too_high' }
  return out
}

/**
 * THE PAD'S FLOOR LEVEL -> { ok, L, cols, cost } | { ok: false, why }. Pure. Every level home.y - 12 .. home.y + 12 where EVERY
 * pad column is feasible (columnAt) and the totals hold (fill <= 40, cut <= 30, litter <= 40); the least earthwork
 * (fill + cut + litter) wins, then the level nearest home's, then the lower. When none is feasible, the reason is the first
 * refusal at the level that got furthest through the pad.
 */
export function levelFor (read, home, pad) {
  let best = null, why = null, mostCols = -1
  for (let L = home.y - 12; L <= home.y + 12; L++) {
    const cols = []
    let bad = null
    for (const [x, z] of pad) { const c = columnAt(read, x, z, L); if (!c.ok) { bad = c; break } cols.push(c) }
    if (bad) { if (cols.length > mostCols) { mostCols = cols.length; why = bad } continue }
    const fill = cols.reduce((n, c) => n + c.fill.length, 0), cut = cols.reduce((n, c) => n + c.cut.length, 0), litter = cols.reduce((n, c) => n + c.litter.length, 0)
    if (fill > EARTH.fill || cut > EARTH.cut || litter > LITTER_MAX) {
      if (cols.length >= mostCols) { mostCols = cols.length; why = { why: litter > LITTER_MAX ? 'litter_over_40' : 'earthwork' } }
      continue
    }
    const cost = fill + cut + litter
    if (!best || cost < best.cost || (cost === best.cost && Math.abs(L - home.y) < Math.abs(best.L - home.y))) best = { ok: true, L, cols, cost }
  }
  return best ?? { ok: false, why: why?.why ?? 'no_level', detail: why?.detail }
}

/**
 * THE SCREEN of one candidate (sections 1-4 above) -> { ok, why, ...site }. Pure. `res` = reservations(plan, ctx).
 */
export function screenSite (read, home, bp, anchor, orient, res, { sector = null } = {}) {
  const { pad, ring } = footprint(bp, anchor, orient)
  const all = [...pad, ...ring]
  for (const [x, z] of all) if (!inDomain(home, x, z)) return { ok: false, why: 'domain' }
  if (sector) for (const [x, z] of all) if (sectorOf(home, x, z) !== sector) return { ok: false, why: 'sector' }
  if (!facesHome(bp, home, anchor, orient)) return { ok: false, why: 'door_not_toward_home' }
  // ---- the floor level (B4) and the plan's reservations over the whole span the level may take ----
  for (const [x, z] of all) { const why = res.column(x, z, home.y - 12, home.y + 17); if (why) return { ok: false, why } }
  const xs = all.map(c => c[0]), zs = all.map(c => c[1])
  if (boxMeetsZones([Math.min(...xs), home.y - 16, Math.min(...zs), Math.max(...xs), home.y + 20, Math.max(...zs)], res.zones)) return { ok: false, why: 'zone' }
  const lv = levelFor(read, home, pad)
  if (!lv.ok) return { ok: false, why: lv.why, detail: lv.detail }
  const { L, cols } = lv
  const s = L + 1, g0 = L
  const fill = [], cut = [], clear = [], felled = new Map()
  let litter = 0
  for (const c of cols) {
    fill.push(...c.fill)
    for (const at of c.plants) clear.push({ at, kind: 'plant', name: nm(read(...at)) })
    for (const at of c.cut) { cut.push(at); clear.push({ at, kind: 'cut', name: nm(read(...at)) }) }
    for (const at of c.litter) { litter++; clear.push({ at, kind: 'scaffold', name: nm(read(...at)) }) }
    for (const at of c.leaves) clear.push({ at, kind: 'leaves', name: nm(read(...at)) })
    for (const at of c.logs) {
      clear.push({ at, kind: 'tree', name: nm(read(...at)) })
      if (![...felled.values()].some(t => t.keys.has(k3(...at)))) {
        const logs = treeOf(read, at)
        if (logs.length > TREE.maxLogs) return { ok: false, why: 'tree_too_big' }
        felled.set(k3(...at), { logs, keys: new Set(logs.map(q => k3(...q))) })
      }
    }
  }
  for (const [x, z] of ring) for (let y = s - 1; y <= s + 2; y++) { const b = read(x, y, z); if (!b) return { ok: false, why: 'unknown' }; if (isLiquid(b)) return { ok: false, why: 'liquid' } }
  if (litter > LITTER_MAX) return { ok: false, why: 'litter_over_40' }
  // ---- the whole-tree rule: every log reachable; one trunk per tree ----
  const padSet = new Set(pad.map(([x, z]) => k2(x, z)))
  const near = (x, z) => { for (let dx = -TREE.out; dx <= TREE.out; dx++) for (let dz = -TREE.out; dz <= TREE.out; dz++) if (padSet.has(k2(x + dx, z + dz))) return true; return false }
  const trees = []
  for (const t of felled.values()) {
    if (t.logs.some(([x, y, z]) => y > s + TREE.above || !near(x, z))) return { ok: false, why: 'tree_out_of_reach' }
    const bases = t.logs.filter(([x, y, z]) => { const below = nm(read(x, y - 1, z)); return !LOG.test(below) && !LEAVES.test(below) })
    // FLOATING logs (no log stands on anything but logs or leaves: placed litter, or a tree whose trunk was cut away) are cleared
    // with no replant owed: there is no trunk to replace
    if (!bases.length) { for (const c of t.logs) if (!clear.some(e => e.at[0] === c[0] && e.at[1] === c[1] && e.at[2] === c[2])) clear.push({ at: c, kind: 'tree', name: nm(read(...c)) }); continue }
    const lowest = Math.min(...bases.map(c => c[1]))
    const trunk = bases.filter(c => c[1] === lowest)
    const species = speciesOf(nm(read(...trunk[0])))
    if (trunk.length > 1 || NEEDS_2X2.has(species)) return { ok: false, why: 'tree_2x2' }
    if (!species) return { ok: false, why: 'tree_species' }
    trees.push({ base: trunk[0], species, logs: t.logs.length, cells: t.logs })
    for (const c of t.logs) if (!clear.some(e => e.at[0] === c[0] && e.at[1] === c[1] && e.at[2] === c[2])) clear.push({ at: c, kind: 'tree', name: nm(read(...c)) })
  }
  return { ok: true, why: 'ok', anchor, orient, s, g0, pad, ring, fill, cut, clear, litter, trees, sector }
}

// ---- the walk and the proof ----------------------------------------------------------------------------------------------

/** A read with an overlay map "x,y,z" -> block. */
export function overlay (read, over) { return (x, y, z) => over.get(k3(x, y, z)) ?? read(x, y, z) }

/**
 * WHERE A BOT CAN WALK FROM HOME -> Set of feet keys. As townplan.walkable, but `block` cells are OBSTACLES that are never a
 * floor (cells about to be placed: a stand may not rely on a block that is not there yet), and the radius is the build's. Pure.
 */
export function walkFrom (read, home, block = new Set(), radius = WALK_R) {
  const isNode = (x, y, z) => {
    if (block.has(k3(x, y, z)) || block.has(k3(x, y + 1, z)) || block.has(k3(x, y - 1, z))) return false
    const f = read(x, y - 1, z), a = read(x, y, z), h = read(x, y + 1, z)
    return !!f && !!a && !!h && isSolid(f) && isPassable(a) && isPassable(h) && !isLiquid(a) && !isLiquid(h)
  }
  // THE SEEDS: every walkable cell of the town's plaza (Chebyshev <= SEED_R, home.y +- 4), not one start cell -- a bot in town
  // stands anywhere there, and town centres are boxed in by scaffold (board-a, hive-a, isolated-c 10-25: home's own cell has a
  // block over its head). "Walks back to town" is reaching any seed: the steps are symmetric (+-1 with head room).
  const seen = new Set(), q = []
  for (let dx = -SEED_R; dx <= SEED_R; dx++) for (let dz = -SEED_R; dz <= SEED_R; dz++) for (let dy = -4; dy <= 4; dy++) {
    const c = [home.x + dx, home.y + dy, home.z + dz]
    if (isNode(...c)) { seen.add(k3(...c)); q.push(c) }
  }
  for (let i = 0; i < q.length; i++) {
    const [x, y, z] = q[i]
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz
      if (Math.max(Math.abs(nx - home.x), Math.abs(nz - home.z)) > radius) continue
      for (const dy of [0, 1, -1]) {
        const ny = y + dy, key = k3(nx, ny, nz)
        if (seen.has(key)) continue
        if (dy === 1) { const hb = read(x, y + 2, z); if (!isPassable(hb) || block.has(k3(x, y + 2, z))) continue }
        if (dy === -1) { const hb = read(nx, y + 1, nz); if (!isPassable(hb) || block.has(k3(nx, y + 1, nz))) continue }
        if (!isNode(nx, ny, nz)) continue
        seen.add(key); q.push([nx, ny, nz])
        break
      }
    }
  }
  return seen
}

const FACES = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
/** Is the segment eye -> point clear of solids (sampled every 0.1; the eye's own cell and `skip` keys ignored)? Pure. */
export function sightClear (read, eye, pt, skip = new Set()) {
  const d = Math.hypot(pt[0] - eye[0], pt[1] - eye[1], pt[2] - eye[2])
  const n = Math.max(1, Math.ceil(d / 0.1))
  for (let i = 1; i < n; i++) {
    const t = i / n
    const x = Math.floor(eye[0] + (pt[0] - eye[0]) * t), y = Math.floor(eye[1] + (pt[1] - eye[1]) * t), z = Math.floor(eye[2] + (pt[2] - eye[2]) * t)
    const key = k3(x, y, z)
    if (skip.has(key)) continue
    if (isSolid(read(x, y, z))) return false
  }
  return true
}

/**
 * ONE STEP for a cell -> { stand, support, face } | null. Pure. `nodes` = walkable feet cells by column ("x,z" -> [y]).
 * A support is a solid neighbour now; the face is the support's face toward the cell; the eye (feet + 1.62, centred) is within
 * REACH of the face centre, on its open side, with a clear sight line; the stand is not the cell (feet or head) and is in the
 * build domain.
 */
export function stepFor (read, home, cell, nodes, { role = null } = {}) {
  const [cx, cy, cz] = cell
  let best = null, bd = Infinity
  for (const [fx, fy, fz] of FACES) {
    if (role === 'light' && fy === 1) continue   // a torch never hangs from the face above it
    const sup = [cx + fx, cy + fy, cz + fz]
    if (!isSolid(read(...sup))) continue
    const normal = [-fx, -fy, -fz]
    const fc = [sup[0] + 0.5 + normal[0] * 0.5, sup[1] + 0.5 + normal[1] * 0.5, sup[2] + 0.5 + normal[2] * 0.5]
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
      const sx = cx + dx, sz = cz + dz
      const ys = nodes.get(k2(sx, sz))
      if (!ys || !inDomain(home, sx, sz)) continue
      for (const sy of ys) {
        if (sx === cx && sz === cz && (sy === cy || sy + 1 === cy)) continue
        const eye = [sx + 0.5, sy + EYE, sz + 0.5]
        const v = [eye[0] - fc[0], eye[1] - fc[1], eye[2] - fc[2]]
        const d = Math.hypot(...v)
        if (d > REACH || d >= bd) continue
        if (v[0] * normal[0] + v[1] * normal[1] + v[2] * normal[2] <= 0) continue
        if (!sightClear(read, eye, fc, new Set([k3(sx, sy + 1, sz), k3(...sup), k3(cx, cy, cz)]))) continue
        best = { stand: [sx, sy, sz], support: sup, face: normal }; bd = d
      }
    }
  }
  return best
}

const byColumn = keys => {
  const m = new Map()
  for (const key of keys) { const [x, y, z] = key.split(',').map(Number); const c = k2(x, z); if (!m.has(c)) m.set(c, []); m.get(c).push(y) }
  return m
}
const blockFor = (bp, role) => { const first = (bp.palette[role] ?? ['stone'])[0]; return first.startsWith('$') ? 'oak_planks' : first }

/**
 * THE PROOF of a screened site (section 5 above) -> { ok, why, cells, segments, interior }. Pure.
 * The world is the read with the clears applied (air). The FILL is proven as its own first segment `earth` (cobblestone, from
 * the bottom up), then the blueprint's segments in order. The clears themselves (dig reach and order) are not proven here.
 */
export function proveSite (read, home, bp, site) {
  const over = new Map()
  for (const c of site.clear) over.set(k3(...c.at), AIR)
  const R = overlay(read, over)
  const earth = site.fill.map(at => ({ at, role: 'fill', seg: 'earth', u: 0, v: 0, y: -1 }))
  const cells = [...earth, ...placeBlueprint(bp, site.anchor, site.s, site.orient)]
  for (const c of cells) {
    const b = R(...c.at)
    if (!b) return { ok: false, why: 'unknown' }
    if (!(replaceableCell(b) || b === AIR)) return { ok: false, why: 'cell_not_free', detail: `${nm(b)}@${c.at.join(',')}` }
  }
  const out = [], segOut = []
  let order = 0
  const segments = [...(earth.length ? [{ seg: 'earth', layer: -1, deps: [] }] : []), ...bp.segments.map(s => (s.seg === 'pad' && earth.length ? { ...s, deps: ['earth'] } : s))]
  for (const sg of segments) {
    const mine = cells.filter(c => c.seg === sg.seg)
    // the cells STILL TO PLACE in this segment are obstacles and never floors; every placed cell (earlier segments, and this
    // one's so far) is in the overlay: a wall, and a floor. The walk is recomputed only when no cell has a step and something
    // was placed since the last walk (a builder walks onto the pad it has laid); with nothing new, the cell is no_step.
    const left = mine.slice().sort((a, b) => a.at[1] - b.at[1] || a.u - b.u || a.v - b.v)
    const walkNow = () => byColumn(walkFrom(R, home, new Set(left.filter(c => (ROLE_BOX[c.role] ?? 'block') === 'block').map(c => k3(...c.at)))))
    let nodes = walkNow(), fresh = true, walks = 1
    while (left.length) {
      let pick = -1, step = null
      for (let i = 0; i < left.length; i++) {
        step = stepFor(R, home, left[i].at, nodes, { role: left[i].role })
        if (step) { pick = i; break }
      }
      if (pick < 0 && !fresh) { nodes = walkNow(); fresh = true; walks++; continue }
      if (pick < 0) return { ok: false, why: 'no_step', detail: `${sg.seg} ${left.length} left, first ${left[0].role}@${left[0].at.join(',')}`, segments: segOut }
      fresh = false
      const c = left.splice(pick, 1)[0]
      const box = ROLE_BOX[c.role] ?? 'block'
      over.set(k3(...c.at), Object.freeze({ name: c.role === 'fill' ? 'cobblestone' : blockFor(bp, c.role), boundingBox: box }))
      out.push({ at: c.at, role: c.role, seg: c.seg, stand: step.stand, support: step.support, face: step.face, order: order++ })
    }
    segOut.push({ seg: sg.seg, layer: sg.layer, deps: sg.deps, cells: mine.length, walks, stands: new Set(out.filter(o => o.seg === sg.seg).map(o => k3(...o.stand))).size })
  }
  // the finished building: its interior is walked to from home through the open doorway, and every stand walks back
  const final = walkFrom(R, home)
  const interior = bp.interior.filter(([, , y]) => y === 1).map(([u, v]) => { const { dx, dz } = rot(site.orient, u, v); return k3(site.anchor.x + dx, site.s + 1, site.anchor.z + dz) })
  const inside = interior.filter(k => final.has(k)).length
  if (!inside) return { ok: false, why: 'interior_unreachable', segments: segOut }
  return { ok: true, why: 'ok', cells: out, segments: segOut, interior: { cells: interior.length, reachable: inside } }
}

/** Replant cells for the felled trunks -> { ok, cells: [{ cell, species, state }] }. Pure. */
export function replantFor (read, home, site, res, walk) {
  if (!site.trees.length) return { ok: true, cells: [] }
  const padSet = new Set([...site.pad, ...site.ring].map(([x, z]) => k2(x, z)))
  const xs = site.pad.map(c => c[0]), zs = site.pad.map(c => c[1])
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), bz0 = Math.min(...zs), bz1 = Math.max(...zs)
  const nodes = byColumn(walk)
  const used = new Set(), out = []
  const cand = []
  for (let x = bx0 - REPLANT.far; x <= bx1 + REPLANT.far; x++) for (let z = bz0 - REPLANT.far; z <= bz1 + REPLANT.far; z++) {
    const d = Math.max(bx0 - x, x - bx1, bz0 - z, z - bz1, 0)
    if (d < REPLANT.near || d > REPLANT.far || padSet.has(k2(x, z))) continue
    cand.push([d, x, z])
  }
  cand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
  for (const t of site.trees) {
    let got = null
    for (const [, x, z] of cand) {
      if (used.has(k2(x, z))) continue
      const g = groundOf(read, x, z, home.y)
      if (g == null || !SOIL.has(nm(read(x, g, z)))) continue
      let clear = true
      for (let y = g + 1; y <= g + REPLANT.clear; y++) { const b = read(x, y, z); if (!b || nm(b) !== 'air') { clear = false; break } }
      if (!clear) continue
      if (res.column(x, z, g, g + 1) || boxMeetsZones([x, g, z, x, g + 1, z], res.zones)) continue
      let reach = false
      for (let dx = -1; dx <= 1 && !reach; dx++) for (let dz = -1; dz <= 1 && !reach; dz++) {
        if (!dx && !dz) continue
        if ((nodes.get(k2(x + dx, z + dz)) ?? []).some(y => y >= g && y <= g + 2)) reach = true
      }
      if (!reach) continue
      got = { cell: [x, g + 1, z], species: t.species, sapling: SAPLING[t.species], state: 'pending' }
      break
    }
    if (!got) return { ok: false, cells: out }
    used.add(k2(got.cell[0], got.cell[2])); out.push(got)
  }
  return { ok: true, cells: out }
}

/** The bill of a proven cell list by palette role (the first choice; fallbacks are the record's). Pure. */
export function billOf (bp, cells) {
  const out = {}
  for (const c of cells) { const b = c.role === 'fill' ? 'cobblestone' : (bp.palette[c.role] ?? ['?'])[0]; out[b] = (out[b] ?? 0) + 1 }
  return out
}

const ORIENTS = ['E', 'S', 'W', 'N']
// ring@1's order for the outer plots that take what is left (townplan.mjs assignOuter: the cardinals, then the diagonals)
const REST_ORDER = ['S', 'W', 'N', 'E', 'NE', 'SE', 'SW', 'NW']
/**
 * THE SECTORS THE WORKSHOP MAY TAKE, in order -> [{ sector, source }]. Pure. The pavilion's when the plan sited it (design
 * 4.3: the workshop replaces the pavilion as the first roofed build). DEVIATION D1 (named for review): when the plan left the
 * pavilion UNSITED -- its 35-wide extent met a zone, or no sector was free for it (7 of 16 frozen plans, 10-25) -- every
 * sector no other outer plot holds (well, farm, gate, shaft, monument, hall), in ring@1's order. The workshop's own 11 x 9
 * footprint still faces every zone and reservation test cell by cell.
 */
export function workshopSectors (plan) {
  const plots = plan?.plots ?? []
  const pav = plots.find(p => p.kind === 'pavilion')
  if (pav?.sector) return [{ sector: pav.sector, source: 'pavilion' }]
  const taken = new Set(plots.filter(p => p.kind !== 'pavilion' && p.sector).map(p => p.sector))
  return REST_ORDER.filter(s => !taken.has(s)).map(s => ({ sector: s, source: 'free' }))
}

/**
 * SITE A BLUEPRINT FOR A TOWN -> { ok, why, record | null, sectors: [{ sector, source, screened, tried, rejects, proofFails }] }.
 * Pure. Per sector in workshopSectors order: screen every anchor and orientation, sort the survivors (least earthwork, fewest
 * trees, least litter, nearest), prove at most `tries` (PROOF_TRIES); the first proven site with its replant cells wins.
 *   plan  the town plan's head (frozen)
 *   ctx   { zones, wells, farm, z0, m0 } (reservations); { tries }
 */
export function siteBlueprint (read, plan, bp, ctx = {}) {
  const home = plan?.home
  if (!home) return { ok: false, why: 'no_plan', sectors: [] }
  const secs = workshopSectors(plan)
  if (!secs.length) return { ok: false, why: 'no_free_sector', sectors: [] }
  const res = reservations(plan, ctx)
  const out = []
  for (const { sector, source } of secs) {
    const rejects = {}, ok = []
    for (const orient of ORIENTS) {
      for (let x = home.x - DOMAIN.line; x <= home.x + DOMAIN.line; x++) {
        for (let z = home.z - DOMAIN.line; z <= home.z + DOMAIN.line; z++) {
          const r = screenSite(read, home, bp, { x, z }, orient, res, { sector })
          if (r.ok) ok.push(r); else rejects[r.why] = (rejects[r.why] ?? 0) + 1
        }
      }
    }
    const dist = r => Math.hypot(r.pad[0][0] - home.x, r.pad[0][1] - home.z)
    ok.sort((a, b) => (a.fill.length + a.cut.length + a.litter) - (b.fill.length + b.cut.length + b.litter) || a.trees.length - b.trees.length || dist(a) - dist(b))
    const proofFails = {}
    const tries = Math.min(ok.length, ctx.tries ?? PROOF_TRIES)
    const row = { sector, source, screened: ok.length, tried: 0, rejects, proofFails }
    out.push(row)
    for (let i = 0; i < tries; i++) {
      const site = ok[i]
      row.tried = i + 1
      const p = proveSite(read, home, bp, site)
      if (!p.ok) { proofFails[p.why] = (proofFails[p.why] ?? 0) + 1; continue }
      const over = new Map()
      for (const c of site.clear) over.set(k3(...c.at), AIR)
      for (const c of site.fill) over.set(k3(...c), SOLID('cobblestone'))
      const rp = replantFor(read, home, site, res, walkFrom(overlay(read, over), home))
      if (!rp.ok) { proofFails.no_replant_cell = (proofFails.no_replant_cell ?? 0) + 1; continue }
      const xs = site.pad.map(c => c[0]), zs = site.pad.map(c => c[1])
      const record = {
        v: 1, blueprint: bp.id, plot: 'workshop', home, sector, sector_source: source, orient: site.orient, anchor: [site.anchor.x, site.anchor.z],
        box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], s: site.s, floor: site.g0,
        earthwork: { fill: site.fill.length, cut: site.cut.length, litter: site.litter },
        fill: site.fill, clear: site.clear.map(c => ({ at: c.at, kind: c.kind, name: c.name })),
        trees: site.trees.map(t => ({ base: t.base, species: t.species, logs: t.logs })), replant: rp.cells,
        cells: p.cells, segments: p.segments, interior: p.interior, bom: billOf(bp, p.cells), builders_max: 2,
        structure_complete: false, plan: { gen: plan.gen },
      }
      return { ok: true, why: 'ok', record, sectors: out }
    }
  }
  const any = out.some(r => r.screened)
  return { ok: false, why: any ? 'no_proven_site' : 'no_site', record: null, sectors: out }
}
