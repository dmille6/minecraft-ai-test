// BRIDGES-01: DESIGNED BRIDGES (OWNER 2026-11-08: "if a bridge is built i want it to be something really nice looking, professional
// and creative. something showcase worthy"; design docs/reports/bridges-design-2026-11-08.md, Claude + Codex reconciled). PURE: no bot,
// no world, no files -- the span, the style, the cells, the build order, the bill, the crossing observer and the traffic sites.
//
// FOUR STYLES, each a set of target cells in the span's LOCAL frame (u along the crossing: 0 is the first water column, -1 the near
// shore's stand column; v across it, +v = the axis turned left; y absolute) with their block and WORLD state:
//   arch     stone-brick ARCADE: deck 5 wide at wy + 3 (a slab walkway between full edge blocks, wall parapets), stair ramps over the
//            first and last rows on solid abutments, bays of 3 or 5 under the deck (upside-down stair haunches, a contrasting KEYSTONE
//            in the deck face at each crown, a lantern hung under it), piers between bays, lamp posts on the parapet
//   covered  TIMBER COVERED BRIDGE: deck 5 wide at the water (log sills, plank floor, cross beams at the bents), log posts, fence
//            rails (glass windows), log plates and tie beams, a 45-degree stair roof with eaves, plank gables, a ridge with a slab cap,
//            lanterns hung under the ridge
//   trestle  TRESTLE for long spans and marsh: deck 3 wide at wy + 2 (stringers, a plank or slab walkway, fence or wall rails), stone
//            abutments, bents (cross beam, two legs, a cap) every 3-4 rows with knee braces, stone piers on islets, lamp posts
//   foot     FOOTBRIDGE for streams (w <= 8): deck 3 wide at wy + 1, a stair step at each end, piles, rails, lamp posts at the ends
// THE BUILD ORDER IS SOLVED, NOT WRITTEN (solveDesign): the bot stands on the walkway's centre of row k-1 (the near stand for row 0)
// and clicks every cell it can: a face of a block already standing (a placed cell or a known anchor of the near shore) whose click
// makes the cell's state (townstyle.mjs orientAim: a stair's facing is the yaw sent before the click, its half the clicked face or the
// cursor; a slab's type likewise; a log's axis the face's axis; a hanging lantern from an underside), on a part of that block that is
// solid (refFaceOk), never a slab merge, within REACH of the eye, never into its own body; it steps onto row k once row k's walkway
// block stands. A required cell no stand can click is a planner error (tests: every style, every bank); an optional one is dropped.
// Every step carries { cell, stand, ref, face, item, st, aim, kind, role, want } and bridge.mjs buildBridge executes it (bridgeio.mjs
// sends the yaw and the cursor); progress is read from the world, so a half-built bridge resumes from what stands.

import { orientAim, slabMerges, seedOf } from './townstyle.mjs'

const OFF = ['off', '0', 'false', 'no']
/** BRIDGE_DESIGN=on|off (default on): a NEW bridge site is built to a designed style when one fits and the town can pay for it. Off:
 *  the legacy cobble / plank bridge (bridgepost-01 / boardwalk-01) exactly as before, and a designed site not yet finished is left
 *  as it stands (its footprint still kept off). Pure. */
export const bridgeDesignOn = (env = process.env) => !OFF.includes(String(env?.BRIDGE_DESIGN ?? '').trim().toLowerCase())
/** BRIDGE_TRAFFIC=on|off (default on): the crossings the bots swim near town are logged, and a busy one becomes a bridge site. Pure. */
export const bridgeTrafficOn = (env = process.env) => !OFF.includes(String(env?.BRIDGE_TRAFFIC ?? '').trim().toLowerCase())

export const DESIGN_V = 1
export const REACH = 4.5                 // eye to the click point (the server allows block_interaction_range 4.5 + 1: kept tight)
export const EYE = 1.62
export const DESIGN_MAX = 40             // wet + islet columns a designed bridge spans at most
export const ISLET_MAX = 3               // an islet run inside a crossing at most this wide (wider: a far shore)
export const LIGHT_ICE_R = 3             // no lantern within this (taxicab) of ice: block light > 11 melts it (showcase lakes are frozen)
export const LAND_INLAND_D = 3
export const STYLES = Object.freeze(['arch', 'covered', 'trestle', 'foot'])

// ---- palettes ------------------------------------------------------------------------------------------------------------------
export const STONE_PALETTES = Object.freeze({
  stone: Object.freeze({ base: 'stone_bricks', full: 'stone_bricks', stairs: 'stone_brick_stairs', slab: 'stone_brick_slab', wall: 'stone_brick_wall' }),
  deepslate: Object.freeze({ base: 'deepslate_bricks', full: 'deepslate_bricks', stairs: 'deepslate_brick_stairs', slab: 'deepslate_brick_slab', wall: 'deepslate_brick_wall' }),
})
export const woodPalette = s => ({ log: `${s}_log`, planks: `${s}_planks`, stairs: `${s}_stairs`, slab: `${s}_slab`, fence: `${s}_fence` })

// ---- the frame -----------------------------------------------------------------------------------------------------------------
const FACING = { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' }
/** The span's frame -> { at(u, v, y) -> [x, y, z], dir(name) -> [dx, dz], facing(name), axisOf(name) }. Pure. `name`: '+u' ... */
export function frameOf (span) {
  const [ax, az] = span.axis, lx = -az, lz = ax
  const [nx, , nz] = span.near
  const dirs = { '+u': [ax, az], '-u': [-ax, -az], '+v': [lx, lz], '-v': [-lx, -lz] }
  return {
    at: (u, v, y) => [nx + ax * (u + 1) + lx * v, y, nz + az * (u + 1) + lz * v],
    dir: d => dirs[d],
    facing: d => FACING[dirs[d].join(',')],
    axisOf: d => (dirs[d][0] !== 0 ? 'x' : 'z'),
  }
}
const key = c => c.join(',')

/** A seeded chooser over a site id -> pick(name, options). Each knob has its own stream (one knob never shifts another). Pure. */
export function chooser (id) {
  // FNV-1a's low bits barely move between ids that differ in their last character: a murmur3 finaliser spreads them
  const mix = h => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; return (h ^ (h >>> 16)) >>> 0 }
  return (name, opts) => opts[mix(seedOf(`${id}|${name}`)) % opts.length]
}

// ---- the span ------------------------------------------------------------------------------------------------------------------
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const solid = b => !!b && b.boundingBox === 'block'
const wl = b => b?.waterlogged === true || /\[waterlogged\]$/.test(String(b?.name ?? ''))
const isWater = b => !!b && nm(b) === 'water' && !wl(b)
const ICE = /^(ice|frosted_ice|packed_ice|blue_ice)$/
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|.*concrete_powder)$/
const HAZARD = /^(lava|bubble_column|magma_block|soul_sand)$/
const AIRISH = b => !!b && /^(air|cave_air|void_air)$/.test(nm(b))
const SOFT = /^(short_grass|tall_grass|fern|large_fern|snow|dead_bush|seagrass|tall_seagrass|kelp|kelp_plant|lily_pad|.*_flower|poppy|dandelion|.*_tulip|cornflower|azure_bluet|oxeye_daisy|allium|lily_of_the_valley)$/
const passable = b => !!b && !solid(b) && !isWater(b) && !wl(b) && !/^(lava|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/.test(nm(b))
// a shore stand: solid ground (sand and gravel too: a beach is ground; what stands on it is never placed INTO a falling block's cell)
const standable = (read, x, y, z) => { const g = read(x, y - 1, z); return solid(g) && !wl(g) && passable(read(x, y, z)) && passable(read(x, y + 1, z)) }
/** May a designed block be clicked INTO the cell: water, air, or a soft plant (vanilla replaces it)? Pure. */
export const designInto = b => !!b && !wl(b) && (isWater(b) || AIRISH(b) || SOFT.test(nm(b)))

/**
 * THE DESIGN SPAN from a near-shore stand along an axis -> { ok, near, far, land, axis, wy, w, rows, nb, fb, islets } | { ok: false,
 * why }. Pure. Like bridge.mjs bridgeSpan, plus ISLETS: a land run of at most ISLET_MAX columns whose ground is no higher than wy + 1
 * inside the crossing is part of it (its row carries `isl`: the ground's top y), so a marsh with islands is one crossing. The near
 * stand at wy + 1 .. wy + 3 (nb = stand - wy - 1: 0..2) with solid ground under it down to wy (the build's anchors), the far shore
 * likewise and LAND_INLAND_D standable columns past it; ice on the line refuses (no lantern goes near ice either: lightOk);
 * each water row carries its `depth` (to 8). Whether a design's body fits beside the line is designFits' question.
 */
export function designSpan (read, near, axis, { max = DESIGN_MAX, zones = [], margin = 4 } = {}) {
  const [ax, az] = axis, lx = -az, lz = ax
  const [x0, y0, z0] = near
  if (!standable(read, x0, y0, z0)) return { ok: false, why: 'near_unstandable' }
  let wy = null
  for (let y = y0; y >= y0 - 12; y--) { const b = read(x0 + ax, y, z0 + az); if (b == null) return { ok: false, why: 'unread' }; if (isWater(b)) { wy = y; break } if (solid(b)) break }
  if (wy == null) return { ok: false, why: 'no_water' }
  if (isWater(read(x0 + ax, wy + 1, z0 + az))) return { ok: false, why: 'deep_surface' }
  const nb = y0 - wy - 1
  if (nb < 0) return { ok: false, why: 'near_wet' }
  if (nb > 2) return { ok: false, why: 'bank_high', bank: nb }
  for (let y = wy; y < y0; y++) { const g = read(x0, y, z0); if (!solid(g)) return { ok: false, why: 'no_ref' } }
  const inZone = (x, z) => {
    for (const q of zones ?? []) {
      const b = Array.isArray(q?.box) ? q.box : [q?.x0, q?.y0, q?.z0, q?.x1, q?.y1, q?.z1]
      if (!b.every(Number.isFinite)) continue
      if (x >= b[0] - margin && x <= b[3] + margin && z >= b[2] - margin && z <= b[5] + margin) return String(q.id ?? q.why ?? 'zone')
    }
    return null
  }
  const rows = []
  let islRun = 0
  const rowOf = (i, x, z, extra) => ({ i, centre: [x, wy, z], sides: [-1, 1].map(s => ({ side: s, deck: [x + lx * s, wy, z + lz * s], rail: [x + lx * s, wy + 1, z + lz * s] })), ...extra })
  for (let i = 1; i <= max + ISLET_MAX + 2; i++) {
    const x = x0 + ax * i, z = z0 + az * i
    const c = read(x, wy, z)
    if (c == null) return { ok: false, why: 'unread' }
    if (ICE.test(nm(c))) return { ok: false, why: 'ice' }   // ice beside the line is designFits' question (no block goes into ice)
    const zid = inZone(x, z) ?? inZone(x + lx * 2, z + lz * 2) ?? inZone(x - lx * 2, z - lz * 2)
    if (zid) return { ok: false, why: 'zone', zone: zid }
    if (HAZARD.test(nm(c))) return { ok: false, why: `hazard_${nm(c)}` }
    if (!isWater(c)) {
      // land: an ISLET (low, narrow, water again within ISLET_MAX) or the far shore
      let top = null
      for (let y = wy + 3; y >= wy - 1; y--) if (solid(read(x, y, z))) { top = y; break }
      let beyond = 0
      for (let k = 1; k <= ISLET_MAX; k++) { const q = read(x + ax * k, wy, z + az * k); if (q == null) break; if (isWater(q)) { beyond = k; break } }
      if (rows.length > 0 && top != null && top <= wy + 1 && beyond > 0 && islRun + beyond <= ISLET_MAX) {
        islRun++
        rows.push(rowOf(i - 1, x, z, { isl: top }))
        if (rows.length > max) return { ok: false, why: 'wide', w: rows.length }
        continue
      }
      while (rows.length && rows[rows.length - 1].isl != null) rows.pop()
      if (!rows.length) return { ok: false, why: 'no_water' }
      const w = rows.length
      const fx = x0 + ax * (w + 1), fz = z0 + az * (w + 1)
      let fy = null
      for (let y = wy + 1; y <= wy + 3; y++) if (standable(read, fx, y, fz)) { fy = y; break }
      if (fy == null) return { ok: false, why: 'far_bank' }
      let ly = fy
      for (let k = 1; k <= LAND_INLAND_D; k++) {
        let s = null
        for (const dy of [0, 1, -1]) if (standable(read, fx + ax * k, ly + dy, fz + az * k)) { s = ly + dy; break }
        if (s == null) return { ok: false, why: 'far_narrow' }
        ly = s
      }
      return { ok: true, near: [x0, y0, z0], far: [fx, fy, fz], land: [fx + ax * LAND_INLAND_D, ly, fz + az * LAND_INLAND_D], axis: [ax, az], wy, w, rows, nb, fb: fy - wy - 1, islets: rows.filter(r => r.isl != null).length, src: 'design' }
    }
    islRun = 0
    if (rows.length >= max) return { ok: false, why: 'wide', w: rows.length + 1 }
    if (AIRISH(read(x, wy - 1, z))) return { ok: false, why: 'not_lake' }
    let depth = 0
    for (let y = wy; y >= wy - 7 && isWater(read(x, y, z)); y--) depth++
    rows.push(rowOf(i - 1, x, z, { depth }))
  }
  return { ok: false, why: 'wide', w: rows.length }
}
/** A span's banks (nb, fb: each stand's height above wy + 1); a legacy bridgepost span has none stored: from its ends. Pure. */
export function spanBanks (span) {
  const nb = Number(span?.nb ?? (span?.near?.[1] - span?.wy - 1)), fb = Number(span?.fb ?? (span?.far?.[1] - span?.wy - 1))
  return { nb: Number.isFinite(nb) ? nb : 0, fb: Number.isFinite(fb) ? fb : 0 }
}

// ---- the styles: target cells --------------------------------------------------------------------------------------------------
// A cell: { u, v, y, item, st (WORLD state or null), role, opt (dropped when unreachable), want ('item': this block in this state;
// null: any solid stands for it -- a support whose cell is the bank's own rock) }

/** The walkway rows: each row's tread block y and kind ('up' stairs from the near stand to the deck, 'flat', 'down' stairs to the far
 *  stand) -> [{ u, y, kind }] | null (the ramps do not fit). Pure. */
export function walkway (w, D, wy, nb, fb) {
  const up = [], down = []
  for (let y = wy + 1 + nb; y < D; y++) up.push(y)
  for (let y = wy + 1 + fb; y < D; y++) down.push(y)
  down.reverse()
  if (up.length + down.length > w) return null
  const out = []
  for (let u = 0; u < w; u++) {
    if (u < up.length) out.push({ u, y: up[u], kind: 'up' })
    else if (u >= w - down.length) out.push({ u, y: down[u - (w - down.length)], kind: 'down' })
    else out.push({ u, y: D, kind: 'flat' })
  }
  return out
}
function cellsBuilder () {
  const cells = []
  const put = (u, v, y, item, st = null, role = 'deck', extra = {}) => cells.push({ u, v, y, item, st, role, want: 'item', ...extra })
  const any = (u, v, y, item, role = 'support', extra = {}) => cells.push({ u, v, y, item, st: null, role, want: null, ...extra })
  return { cells, put, any }
}

/** Bays of 3 or 5 with 1-row piers filling Z rows, the wide bays in the middle -> { bays, lead, tail } | null. Pure. `pref` 'wide'
 *  (fewest piers) or 'many' (most piers). Rows no layout fills become extra abutment rows at the ends (lead / tail). */
export function bayLayout (Z, pref = 'wide') {
  for (let extra = 0; extra <= 4; extra++) {
    const z = Z - extra
    if (z < 3) return null
    const opts = []
    for (let n = 1; n <= z; n++) {
      const s = z - (n - 1)
      const fives = (s - 3 * n) / 2
      if (Number.isInteger(fives) && fives >= 0 && fives <= n) opts.push({ n, fives })
    }
    if (!opts.length) continue
    const o = pref === 'many' ? opts[opts.length - 1] : opts[0]
    const bays = Array(o.n).fill(3)
    const mid = (o.n - 1) / 2
    const order = [...bays.keys()].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)
    for (let k = 0; k < o.fives; k++) bays[order[k]] = 5
    return { bays, lead: Math.floor(extra / 2), tail: extra - Math.floor(extra / 2) }
  }
  return null
}

/** THE ARCH (stone arcade). -> { cells, D, ww } | { why }. */
function archCells (span, v, F) {
  const { w, wy } = span, { nb, fb } = spanBanks(span)
  const D = wy + 3
  const P = STONE_PALETTES[v.palette], K = STONE_PALETTES[v.palette === 'stone' ? 'deepslate' : 'stone'].full
  const ww = walkway(w, D, wy, nb, fb)
  if (!ww) return { why: 'short' }
  const flat = ww.filter(r => r.kind === 'flat').map(r => r.u)
  if (flat.length < 5) return { why: 'short' }
  const { cells, put, any } = cellsBuilder()
  const supp = (u, vv, y0) => { for (let y = y0; y >= wy; y--) any(u, vv, y, P.full) }
  const fUp = F.facing('+u'), fDn = F.facing('-u')
  // the ramps: stairs across the walkway (v -1..1), a full edge block with a wall on it, all on supports down to the water
  for (const r of ww.filter(q => q.kind !== 'flat')) {
    const f = r.kind === 'up' ? fUp : fDn
    for (const vv of [-1, 0, 1]) { put(r.u, vv, r.y, P.stairs, { facing: f, half: 'bottom' }, vv === 0 ? 'walk' : 'stair'); supp(r.u, vv, r.y - 1) }
    for (const vv of [-2, 2]) { any(r.u, vv, r.y, P.full, 'edge'); supp(r.u, vv, r.y - 1); put(r.u, vv, r.y + 1, P.wall, null, 'rail') }
  }
  // the flat deck between two abutment rows (u0, u1: solid to D-2), the bays between them
  const u0 = flat[0], u1 = flat[flat.length - 1]
  const lay = bayLayout(u1 - u0 - 1, v.bays)
  if (!lay) return { why: 'no_layout' }
  const under = new Map([[u0, 'abut'], [u1, 'abut']])
  let u = u0 + 1
  for (let n = 0; n < lay.lead; n++) under.set(u++, 'abut')
  lay.bays.forEach((O, i) => { for (let k = 1; k <= O; k++) under.set(u++, { bay: O, k }); if (i < lay.bays.length - 1) under.set(u++, 'pier') })
  for (let n = 0; n < lay.tail; n++) under.set(u++, 'abut')
  const crowns = []
  for (const uu of flat) {
    const t = under.get(uu)
    const crown = !!t && typeof t === 'object' && t.k === (t.bay + 1) / 2
    if (crown) crowns.push(uu)
    for (const vv of [-2, 2]) { put(uu, vv, D, crown ? K : P.full, null, crown ? 'key' : 'edge'); put(uu, vv, D + 1, P.wall, null, 'rail') }
    for (const vv of [-1, 0, 1]) put(uu, vv, D, P.slab, { type: 'top' }, vv === 0 ? 'walk' : 'deck')
    for (const vv of [-2, -1, 0, 1, 2]) {
      if (t === 'abut' || t === 'pier') { any(uu, vv, D - 1, P.full, t === 'pier' ? 'pier' : 'under'); any(uu, vv, D - 2, P.full, t === 'pier' ? 'pier' : 'under') }
      else if (t && typeof t === 'object') {
        // a haunch's low quarter toward the bay's nearer support (-u for the first half, +u for the second)
        const toward = t.k <= t.bay / 2 ? fDn : fUp
        if (t.bay === 3) { if (t.k !== 2) put(uu, vv, D - 1, P.stairs, { facing: toward, half: 'top' }, 'arch') }
        else if (t.k === 1 || t.k === 5) { any(uu, vv, D - 1, P.full, 'arch'); put(uu, vv, D - 2, P.stairs, { facing: toward, half: 'top' }, 'arch') }
        else if (t.k === 2 || t.k === 4) put(uu, vv, D - 1, P.stairs, { facing: toward, half: 'top' }, 'arch')
      }
    }
  }
  // the lights: lamp posts (a wall on the parapet, a lantern on it) at both abutments and at the piers ('every' | 'alt'); a lantern
  // hung under the keystones ('every' | 'centre' | 'none')
  const piers = [...under.entries()].filter(([, t]) => t === 'pier').map(([uu]) => uu).sort((a, b) => a - b)
  const postAt = [u0, ...piers.filter((_, i) => v.posts === 'every' || i % 2 === 0), u1]
  postAt.forEach((uu, i) => {
    const sides = v.posts === 'every' || i === 0 || i === postAt.length - 1 ? [-2, 2] : [i % 2 ? 2 : -2]
    for (const vv of sides) { put(uu, vv, D + 2, P.wall, null, 'post'); put(uu, vv, D + 3, 'lantern', { hanging: false }, 'light', { opt: true }) }
  })
  const hang = v.crown === 'every' ? crowns : v.crown === 'centre' && crowns.length ? [crowns[Math.floor((crowns.length - 1) / 2)]] : []
  for (const uu of hang) for (const vv of [-2, 2]) put(uu, vv, D - 1, 'lantern', { hanging: true }, 'light', { opt: true })
  return { cells, D, ww }
}

/** THE COVERED BRIDGE (timber). */
function coveredCells (span, v, F) {
  const { w, wy } = span, { nb, fb } = spanBanks(span)
  const D = wy + Math.min(nb, fb, 1)
  const W = woodPalette(v.species)
  const { cells, put } = cellsBuilder()
  const ax = F.axisOf('+u'), lat = F.axisOf('+v')
  const inP = F.facing('+v'), inM = F.facing('-v')   // a stair on the -v side faces +v (rises toward the ridge), and the mirror
  const bents = new Set([0, w - 1])
  for (let u = v.bent; u < w - 1; u += v.bent) if (w - 1 - u >= 2) bents.add(u)
  const inner = [...bents].sort((a, b) => a - b).filter(u => u !== 0 && u !== w - 1)
  const lit = new Set(inner.filter((_, i) => v.lights === 'every' || i % 2 === 0))
  for (let u = 0; u < w; u++) {
    const portal = u === 0 || u === w - 1, bent = bents.has(u)
    for (const vv of [-1, 0, 1]) put(u, vv, D, W.planks, null, vv === 0 ? 'walk' : 'deck')
    for (const vv of [-2, 2]) {
      // at a bent the floor beam runs across (axis v) and carries the post; between bents the sill runs along (axis u)
      put(u, vv, D, W.log, { axis: bent ? lat : ax }, 'edge')
      if (bent) { for (const y of [D + 1, D + 2, D + 3]) put(u, vv, y, W.log, { axis: 'y' }, 'post'); for (const y of [D - 1, D - 2]) put(u, vv, y, W.log, { axis: 'y' }, 'leg', { opt: true }) }
      else { put(u, vv, D + 1, W.fence, null, 'rail'); put(u, vv, D + 3, W.log, { axis: ax }, 'plate'); if (v.sides === 'windows') put(u, vv, D + 2, 'glass_pane', null, 'rail', { opt: true }) }
      put(u, vv, D + 4, W.stairs, { facing: vv < 0 ? inP : inM, half: 'bottom' }, 'roof')
      put(u, vv < 0 ? -3 : 3, D + 3, W.stairs, { facing: vv < 0 ? inP : inM, half: 'bottom' }, 'eave')
    }
    if (bent) for (const vv of [-1, 0, 1]) put(u, vv, D + 3, W.log, { axis: lat }, 'tie')
    if (portal) for (const vv of [-1, 0, 1]) put(u, vv, D + 4, W.planks, null, 'gable')
    for (const vv of [-1, 1]) put(u, vv, D + 5, W.stairs, { facing: vv < 0 ? inP : inM, half: 'bottom' }, 'roof')
    put(u, 0, D + 5, W.planks, null, 'ridge')
    put(u, 0, D + 6, W.slab, { type: 'bottom' }, 'ridge')
    if (lit.has(u)) put(u, 0, D + 4, 'lantern', { hanging: true }, 'light', { opt: true })
  }
  return { cells, D, ww: Array.from({ length: w }, (_, u) => ({ u, y: D, kind: 'flat' })) }
}

/** THE TRESTLE (timber on stone abutments, or all stone; long spans, marsh with islets). */
function trestleCells (span, v, F) {
  const { w, wy } = span, { nb, fb } = spanBanks(span)
  const D = wy + 2
  const ww = walkway(w, D, wy, nb, fb)
  if (!ww) return { why: 'short' }
  const flat = ww.filter(r => r.kind === 'flat').map(r => r.u)
  if (flat.length < 2) return { why: 'short' }
  const stone = v.mat === 'stone'
  const SP = STONE_PALETTES[v.palette ?? 'deepslate'], W = stone ? null : woodPalette(v.species)
  const ax = F.axisOf('+u'), lat = F.axisOf('+v')
  const M = stone
    ? { stringer: SP.full, beam: SP.full, walk: SP.slab, walkSt: { type: 'top' }, rail: 'cobbled_deepslate_wall', leg: 'polished_deepslate', legSt: null, cap: SP.full, capSt: null, brace: SP.stairs, stair: SP.stairs, post: 'cobbled_deepslate_wall', abut: SP.full }
    : { stringer: W.log, stringerSt: { axis: ax }, beam: W.log, beamSt: { axis: lat }, walk: W.planks, walkSt: null, rail: W.fence, leg: W.log, legSt: { axis: 'y' }, cap: W.log, capSt: { axis: lat }, brace: W.stairs, stair: W.stairs, post: W.fence, abut: 'cobbled_deepslate' }
  const { cells, put, any } = cellsBuilder()
  const fUp = F.facing('+u'), fDn = F.facing('-u')
  const isl = new Map((span.rows ?? []).filter(r => r.isl != null).map(r => [r.i, r.isl]))
  const supp = (u, vv, y0) => { for (let y = y0; y >= wy; y--) { if (isl.has(u) && y <= isl.get(u)) break; any(u, vv, y, M.abut) } }
  // the ramps and the two end bents stand on STONE ABUTMENTS (a timber span on masonry ends)
  for (const r of ww.filter(q => q.kind !== 'flat')) {
    put(r.u, 0, r.y, M.stair, { facing: r.kind === 'up' ? fUp : fDn, half: 'bottom' }, 'walk'); supp(r.u, 0, r.y - 1)
    for (const vv of [-1, 1]) { any(r.u, vv, r.y, M.abut, 'edge'); supp(r.u, vv, r.y - 1); put(r.u, vv, r.y + 1, M.rail, null, 'rail') }
  }
  const u0 = flat[0], u1 = flat[flat.length - 1]
  const bents = new Set([u0, u1])
  for (let u = u0 + v.bent; u < u1; u += v.bent) if (u1 - u >= 2) bents.add(u)
  const bentList = [...bents].sort((a, b) => a - b)
  for (const u of flat) {
    const end = u === u0 || u === u1
    put(u, 0, D, M.walk, M.walkSt, 'walk')
    for (const vv of [-1, 1]) { put(u, vv, D, bents.has(u) ? M.beam : M.stringer, bents.has(u) ? (M.beamSt ?? null) : (M.stringerSt ?? null), 'edge'); put(u, vv, D + 1, M.rail, null, 'rail') }
    if (end) { for (const vv of [-1, 0, 1]) supp(u, vv, D - 1); continue }
    if (isl.has(u)) { for (const vv of [-1, 0, 1]) for (let y = D - 1; y > isl.get(u); y--) any(u, vv, y, M.abut, 'pier'); continue }
    if (bents.has(u)) {
      for (const vv of [-1, 1]) { put(u, vv, D - 1, M.leg, M.legSt, 'leg'); if (!stone) put(u, vv, D - 2, M.leg, M.legSt, 'leg', { opt: true }) }
      put(u, 0, D - 1, M.cap, M.capSt, 'cap')
    } else if (v.braces && (bents.has(u - 1) || bents.has(u + 1))) {
      const toward = bents.has(u - 1) ? fDn : fUp
      for (const vv of [-1, 1]) put(u, vv, D - 1, M.brace, { facing: toward, half: 'top' }, 'brace', { opt: true })
    }
  }
  // lamp posts on the rails: both ends, then every second bent, alternating sides ('alt') or both ('both')
  bentList.forEach((u, i) => {
    const end = i === 0 || i === bentList.length - 1
    if (!end && i % 2) return
    const sides = end || v.lamps === 'both' ? [-1, 1] : [(i / 2) % 2 ? 1 : -1]
    for (const vv of sides) { put(u, vv, D + 2, M.post, null, 'post'); put(u, vv, D + 3, 'lantern', { hanging: false }, 'light', { opt: true }) }
  })
  return { cells, D, ww }
}

/** THE FOOTBRIDGE (w <= 8). */
function footCells (span, v, F) {
  const { w, wy } = span
  const D = wy + 1
  const stone = v.mat === 'stone'
  const SP = STONE_PALETTES[v.palette ?? 'stone'], W = stone ? null : woodPalette(v.species)
  const M = stone ? { full: SP.full, side: SP.full, sideSt: null, endSt: null, stair: SP.stairs, rail: SP.wall, post: SP.wall, pile: SP.full, pileSt: null }
    : { full: W.planks, side: W.log, sideSt: { axis: F.axisOf('+u') }, endSt: { axis: 'y' }, stair: W.stairs, rail: W.fence, post: W.fence, pile: W.log, pileSt: { axis: 'y' } }
  const { cells, put, any } = cellsBuilder()
  const ends = w >= 3
  for (let u = 0; u < w; u++) {
    const st = ends && u === 0 ? { facing: F.facing('+u'), half: 'bottom' } : ends && u === w - 1 ? { facing: F.facing('-u'), half: 'bottom' } : null
    put(u, 0, D, st ? M.stair : M.full, st, 'walk')
    // the first row's sides are end posts on piles (nothing along the axis to click a log's end on yet)
    for (const vv of [-1, 1]) { put(u, vv, D, M.side, u === 0 ? M.endSt : M.sideSt, 'edge'); put(u, vv, D + 1, M.rail, null, 'rail') }
    if (u === 0) any(u, 0, wy, M.pile)
    const pile = u === 0 || v.piles === 'every' || u % 2 === 0 || u === w - 1
    // the first row's side piles carry its end posts: any solid (a log clicked from the support's side lies along the crossing)
    if (pile) for (const vv of [-1, 1]) { if (u === 0) any(u, vv, wy, M.pile, 'support'); else put(u, vv, wy, M.pile, M.pileSt, 'pile', { opt: true }) }
  }
  const lampRows = v.lamps === 'both' && w > 1 ? [[0, -1], [0, 1], [w - 1, -1], [w - 1, 1]] : [[0, -1], [0, 1]]
  for (const [u, vv] of lampRows) { put(u, vv, D + 2, M.post, null, 'post'); put(u, vv, D + 3, 'lantern', { hanging: false }, 'light', { opt: true }) }
  return { cells, D, ww: Array.from({ length: w }, (_, u) => ({ u, y: D, kind: 'flat' })) }
}

// ---- the style choice ----------------------------------------------------------------------------------------------------------
/** The variant knobs of a style for a site id (seeded) -> v. Pure. `woodOk` false: a timber/stone style is stone. */
export function variantOf (style, id, { species = 'oak', woodOk = false, palette = null } = {}) {
  const pick = chooser(id)
  const pal = palette ?? pick('palette', ['stone', 'deepslate'])
  if (style === 'arch') return { palette: pal, bays: pick('bays', ['wide', 'many']), posts: pick('posts', ['every', 'alt']), crown: pick('crown', ['centre', 'every', 'none']) }
  if (style === 'covered') return { species, bent: pick('bent', [3, 4]), sides: pick('sides', ['open', 'windows']), lights: pick('lights', ['every', 'alt']) }
  if (style === 'trestle') return { mat: woodOk ? 'wood' : 'stone', species, palette: pal, bent: pick('bent', [3, 4]), braces: pick('braces', [true, false]), lamps: pick('lamps', ['alt', 'both']) }
  if (style === 'foot') return { mat: woodOk ? 'wood' : 'stone', species, palette: pal, piles: pick('piles', ['every', 'alt']), lamps: pick('lamps', ['both', 'one']) }
  return null
}
/** The styles a span's shape allows, best first -> [style]. Pure. Footbridge to 8; arch 9..21 (no islets); covered 4..16 on low banks;
 *  trestle 4..40 and wherever there are islets. */
export function stylesFor (span) {
  const { w } = span, { nb, fb } = spanBanks(span), isl = Number(span?.islets ?? 0) > 0
  if (nb < 0 || fb < 0 || nb > 2 || fb > 2 || !(w >= 1) || w > DESIGN_MAX) return []
  if (isl) return w >= 4 ? ['trestle'] : []
  if (w <= 8) return ['foot']
  const out = []
  if (w <= 21) out.push('arch')
  if (w <= 16 && nb <= 1 && fb <= 1) out.push('covered')
  out.push('trestle')
  return out
}
/** A design's cells for a span -> { ok, cells, D, ww } | { ok: false, why }. Pure. */
export function designCells (span, design) {
  const F = frameOf(span)
  const fn = { arch: archCells, covered: coveredCells, trestle: trestleCells, foot: footCells }[design?.style]
  if (!fn || !design?.v) return { ok: false, why: 'style' }
  const r = fn(span, design.v, F)
  if (r.why) return { ok: false, why: r.why }
  const by = new Map()
  for (const c of r.cells) by.set(key([c.u, c.v, c.y]), { ...c, cell: F.at(c.u, c.v, c.y) })   // one block a cell (the later wins)
  return { ok: true, cells: [...by.values()], D: r.D, ww: r.ww }
}

// ---- the build order -----------------------------------------------------------------------------------------------------------
const FACES = Object.freeze([[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]])
const ROLE_RANK = Object.freeze({ support: 0, walk: 1, deck: 2, edge: 2, key: 2, stair: 2, rail: 3, under: 4, pier: 4, arch: 5, leg: 5, cap: 5, brace: 6, pile: 6, post: 7, plate: 8, tie: 9, gable: 10, roof: 11, eave: 11, ridge: 12, light: 13 })
const FULLISH = n => !/(_stairs|_slab|_wall|_fence|_pane|lantern|torch|_fence_gate|_trapdoor)$/.test(n)
/** May the FACE of a placed block be clicked at cursor height `cy` -> bool. Pure. A full block: any face; a slab or a stair: only where
 *  it is solid (a top slab's sides above its middle, a bottom stair's back face or its other sides below the middle ...); a wall or a
 *  fence: its top only (a lantern or a post on it). */
export function refFaceOk (b, face, cy) {
  const n = String(b?.item ?? '')
  if (FULLISH(n)) return true
  const st = b?.st ?? {}
  const side = face[1] === 0
  if (/_slab$/.test(n)) {
    if (st.type === 'top') return face[1] > 0 || (side && cy > 0.5)
    return face[1] !== 0 || cy < 0.5
  }
  if (/_stairs$/.test(n)) {
    const back = side && FACING[`${face[0]},${face[2]}`] === st.facing
    if (st.half === 'top') return face[1] > 0 || back || (side && cy > 0.5)
    return face[1] < 0 || back || (side && cy < 0.5)
  }
  if (/(_wall|_fence)$/.test(n)) return face[1] > 0
  return false
}
/** The near shore's anchors: the stand column's ground from wy up to under the stand (designSpan checks they are solid). Pure. */
export const nearAnchors = span => { const out = []; for (let y = span.wy; y < span.near[1]; y++) out.push([span.near[0], y, span.near[2]]); return out }
/**
 * THE BUILD ORDER -> { ok, steps, dropped } | { ok: false, why, cell }. Pure. Stand k = -1 is the near stand; stand k >= 0 the walkway
 * tread of row k. From each stand every remaining cell (ranked by role, then row, top down) with a clickable reference within REACH
 * is placed, until none is; the bot steps on once the next row's walkway block is placed.
 */
export function solveDesign (span, d, { anchors = null } = {}) {
  const F = frameOf(span)
  const placed = new Map()
  for (const c of anchors ?? nearAnchors(span)) placed.set(key(c), { item: 'anchor', st: null })
  for (const r of span.rows ?? []) if (r.isl != null) for (const s of [-2, -1, 0, 1, 2]) placed.set(key(F.at(r.i, s, r.isl)), { item: 'anchor', st: null })
  const left = [...d.cells].sort((a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) || a.u - b.u || b.y - a.y || a.v - b.v)
  const walkAt = new Map(d.ww.map(r => [r.u, r.y]))
  const steps = []
  const stands = [{ k: -1, feet: [...span.near] }]
  for (let u = 0; u < span.w; u++) stands.push({ k: u, feet: F.at(u, 0, walkAt.get(u) + 1) })
  const done = new Set()
  for (const s of stands) {
    if (s.k >= 0 && !placed.has(key(F.at(s.k, 0, walkAt.get(s.k))))) return { ok: false, why: 'tread_unplaced', cell: F.at(s.k, 0, walkAt.get(s.k)), steps }
    const eye = [s.feet[0] + 0.5, s.feet[1] + EYE, s.feet[2] + 0.5]
    const body = new Set([key(s.feet), key([s.feet[0], s.feet[1] + 1, s.feet[2]])])
    for (let progress = true; progress;) {
      progress = false
      for (const c of left) {
        const ck = key(c.cell)
        if (done.has(ck) || body.has(ck)) continue
        let best = null
        for (const f of FACES) {
          const r = [c.cell[0] - f[0], c.cell[1] - f[1], c.cell[2] - f[2]]
          const rb = placed.get(key(r))
          if (!rb) continue
          const aim = orientAim(c.item, c.st, f)
          if (!aim) continue
          const cur = aim.cursor.slice()
          // a click with no half to make lands where the reference is solid (a top slab's side: above its middle)
          if (f[1] === 0 && !c.st?.half && !(c.st?.type && /_slab$/.test(c.item))) cur[1] = refFaceOk(rb, f, 0.75) ? 0.75 : 0.25
          if (!refFaceOk(rb, f, cur[1])) continue
          if (rb.item !== 'anchor' && slabMerges(c.item, { name: rb.item, props: rb.st ?? {} }, f, cur[1])) continue
          if (/lantern$/.test(c.item) && c.st?.hanging && !FULLISH(rb.item)) continue
          const p = [r[0] + cur[0], r[1] + cur[1], r[2] + cur[2]]
          const dist = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2])
          if (dist > REACH) continue
          if (!best || dist < best.dist) best = { ref: r, face: f, aim: { yaw: aim.yaw, cursor: cur }, dist }
        }
        if (!best) continue
        done.add(ck)
        placed.set(ck, { item: c.item, st: c.st })
        steps.push({ cell: c.cell, kind: c.role, role: c.role, stand: s.feet, ref: best.ref, face: best.face, item: c.item, st: c.st, aim: best.aim, want: c.want, opt: !!c.opt, row: c.u, reach: Math.round(best.dist * 100) / 100 })
        progress = true
      }
    }
  }
  const miss = d.cells.filter(c => !done.has(key(c.cell)))
  const hard = miss.filter(c => !c.opt)
  if (hard.length) return { ok: false, why: 'unplaceable', cell: hard[0].cell, role: hard[0].role, item: hard[0].item, steps }
  return { ok: true, steps, dropped: miss.map(c => ({ cell: c.cell, role: c.role })) }
}

/** NATURAL GROUND a design may dig out of one of its own cells (a bank's dirt where a ramp stair goes): the bots reshape the shore as
 *  a builder would; never a placed or valuable block. Pure. */
export const NATURAL = /^(dirt|grass_block|coarse_dirt|podzol|rooted_dirt|mud|clay|sand|red_sand|gravel|stone|andesite|diorite|granite|tuff|snow_block|moss_block|dirt_path)$/
export const designClearable = b => !!b && NATURAL.test(nm(b))
export const CLEAR_MAX = 24   // a bridge never becomes earthworks: a site whose cells hold more natural ground than this is no fit
/** DOES THE PLAN FIT THE WORLD -> { ok, clear, why, cell }. Pure. Every required cell must be clickable into (water, air, a soft plant)
 *  or, for a support (want null), already solid, or hold natural ground the build digs first (at most CLEAR_MAX cells); an unread cell
 *  refuses (nothing is sited on what was not seen). */
export function designFits (read, steps) {
  let clear = 0
  for (const s of steps ?? []) {
    if (s.opt || s.role === 'light') continue
    const b = read(...s.cell)
    if (b == null) return { ok: false, why: 'unread', cell: s.cell }
    if (designInto(b)) continue
    if (s.want == null && solid(b)) continue   // the bank's own ground (sand already lying there stands)
    if (designClearable(b) && ++clear <= CLEAR_MAX) continue
    return { ok: false, why: clear > CLEAR_MAX ? 'earthworks' : `cell_${nm(b)}`, cell: s.cell }
  }
  return { ok: true, clear }
}
/** A site's DESIGN { style, v } -> its plan { ok, steps, dropped, D } | { ok: false, why }. Pure. */
export function designPlan (span, design) {
  const dc = designCells(span, design)
  if (!dc.ok) return dc
  const s = solveDesign(span, { cells: dc.cells, ww: dc.ww })
  return s.ok ? { ...s, D: dc.D } : s
}

// ---- the bill -------------------------------------------------------------------------------------------------------------------
/** The blocks a plan places, by item -> { item: n }. Pure. */
export function designBill (steps = []) {
  const out = {}
  for (const s of steps) out[s.item] = (out[s.item] ?? 0) + 1
  return out
}
/**
 * THE BASE MATERIALS a set of blocks takes -> { base: { name: n }, logs }. Pure. Crafted at a table: stairs 6 -> 4, slabs 3 -> 6, walls
 * 6 -> 6, fences 4 planks + 2 sticks -> 3, planks 1 log -> 4, sticks 2 planks -> 4, a lantern 8 nuggets (1 ingot -> 9) + a torch. A
 * stone part is made of its palette's brick; cobbled_deepslate_wall of cobbled deepslate. `logs`: the wood, in logs.
 */
export function designBase (bill = {}) {
  const base = {}
  const add = (n, c) => { if (c > 0) base[n] = (base[n] ?? 0) + c }
  const planks = {}, logs = {}
  for (const [item, n] of Object.entries(bill)) {
    if (!(n > 0)) continue
    const stone = Object.values(STONE_PALETTES).find(p => [p.full, p.stairs, p.slab, p.wall].includes(item))
    if (stone) {
      add(stone.base, item === stone.stairs ? Math.ceil(n / 4) * 6 : item === stone.slab ? Math.ceil(n / 6) * 3 : item === stone.wall ? Math.ceil(n / 6) * 6 : n)
      continue
    }
    if (item === 'cobbled_deepslate_wall') { add('cobbled_deepslate', Math.ceil(n / 6) * 6); continue }
    if (item === 'polished_deepslate') { add('cobbled_deepslate', Math.ceil(n / 4) * 4); continue }
    if (item === 'lantern') { add('lantern_iron', n); continue }
    const m = /^(.*)_(log|planks|stairs|slab|fence)$/.exec(item)
    if (m) {
      const sp = m[1]
      if (m[2] === 'log') logs[sp] = (logs[sp] ?? 0) + n
      else {
        const p = m[2] === 'planks' ? n : m[2] === 'stairs' ? Math.ceil(n / 4) * 6 : m[2] === 'slab' ? Math.ceil(n / 6) * 3 : (() => { const k = Math.ceil(n / 3); return 4 * k + Math.ceil((2 * k) / 4) * 2 })()
        planks[sp] = (planks[sp] ?? 0) + p
      }
      continue
    }
    add(item, n)
  }
  // lanterns: 8 nuggets and a torch each (an ingot makes 9 nuggets)
  if (base.lantern_iron) { const n = base.lantern_iron; delete base.lantern_iron; add('iron_ingot', Math.ceil((n * 8) / 9)); add('torch', n) }
  let total = 0
  for (const sp of new Set([...Object.keys(planks), ...Object.keys(logs)])) { const l = (logs[sp] ?? 0) + Math.ceil((planks[sp] ?? 0) / 4); add(`${sp}_log`, l); total += l }
  return { base, logs: total }
}

/**
 * CHOOSE A SITE'S DESIGN -> { ok, design: { style, v, D, dv }, plan, bill, base, tried } | { ok: false, why, tried }. Pure. The styles
 * the span's shape allows (stylesFor; arch and covered in a seeded order where both fit), for each the timber variant when `woodAvail`
 * (log units above the town's reserve) pays and the stone one otherwise, each palette in seeded order; the first that solves and that
 * `avail` (the town's stock above its keeps, by name) pays wins.
 */
export function chooseDesign (span, { id = '', avail = {}, woodAvail = 0, species = 'oak', read = null } = {}) {
  const pick = chooser(id)
  let order = stylesFor(span)
  if (order.includes('arch') && order.includes('covered') && pick('lead', [0, 1]) === 1) order = ['covered', 'arch', ...order.filter(s => s !== 'arch' && s !== 'covered')]
  const tried = {}
  if (!order.length) return { ok: false, why: 'no_style', tried }
  const p0 = pick('palette', ['stone', 'deepslate'])
  for (const style of order) {
    const woods = style === 'covered' ? [true] : style === 'arch' ? [false] : [true, false]
    for (const woodOk of woods) {
      for (const palette of style === 'covered' ? [null] : [p0, p0 === 'stone' ? 'deepslate' : 'stone']) {
        const v = variantOf(style, id, { species, woodOk, palette })
        const design = { style, v, D: null, dv: DESIGN_V }
        const plan = designPlan(span, design)
        const tag = `${style}:${style === 'covered' ? species : v.mat === 'wood' ? species : palette}`
        if (!plan.ok) { tried[tag] = plan.why; continue }
        // the body must fit the ground beside the line (a bank's rock where a stair goes is no site for this style)
        if (read) { const fit = designFits(read, plan.steps); if (!fit.ok) { tried[tag] = `fit:${fit.why}@${fit.cell.join(',')}`; continue } }
        const bill = designBill(plan.steps)
        const { base, logs } = designBase(bill)
        const short = []
        if (logs > 0 && logs > woodAvail) short.push(`logs:${logs}>${Math.max(0, Math.floor(woodAvail))}`)
        for (const [n, c] of Object.entries(base)) if (!/_log$/.test(n) && c > (Number(avail?.[n]) || 0)) short.push(`${n}:${c}>${Number(avail?.[n]) || 0}`)
        if (short.length) { tried[tag] = `unfunded(${short.slice(0, 3).join(',')})`; continue }
        return { ok: true, design: { ...design, D: plan.D }, plan, bill, base, tried }
      }
    }
  }
  return { ok: false, why: 'unfunded', tried }
}

// ---- executing a designed step (bridge.mjs buildBridge reads these) --------------------------------------------------------------
const propsOfRead = b => { try { return b?.props ?? (typeof b?.getProperties === 'function' ? b.getProperties() : null) } catch { return null } }
/** Is the world block the step's block in its state? Pure. `want: null` (a support): any solid block. */
export function designDone (b, s) {
  if (!b) return false
  if (s.want == null) return solid(b)   // a design never places a falling block: one in a support cell is the bank's own
  if (nm(b) !== s.item) return false
  if (!s.st) return true
  const p = propsOfRead(b)
  if (!p) return false
  for (const [k, v] of Object.entries(s.st)) if (String(p[k]) !== String(v)) return false
  return true
}
/** Does the cell hold the step's block in the WRONG state (to dig and place again)? Pure. */
export const designMisoriented = (b, s) => !!b && s.want === 'item' && !!s.st && nm(b) === s.item && !designDone(b, s)
/** Is the designed crossing WALKABLE: every required step done and every walkway tread's two headroom cells passable? Pure. */
export function designIntact (read, steps) {
  for (const s of steps ?? []) {
    if (s.role === 'light' || s.opt) continue
    if (!designDone(read(...s.cell), s)) return false
    if (s.role === 'walk') { const [x, y, z] = s.cell; if (!passable(read(x, y + 1, z)) || !passable(read(x, y + 2, z))) return false }
  }
  return true
}
/** May a lantern go here: no ice within LIGHT_ICE_R (taxicab) of the cell, every cell read (unloaded: not lit). Pure. */
export function lightOk (read, cell) {
  const [x, y, z] = cell
  for (let dx = -LIGHT_ICE_R; dx <= LIGHT_ICE_R; dx++) for (let dy = -LIGHT_ICE_R; dy <= LIGHT_ICE_R; dy++) for (let dz = -LIGHT_ICE_R; dz <= LIGHT_ICE_R; dz++) {
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > LIGHT_ICE_R) continue
    const b = read(x + dx, y + dy, z + dz)
    if (b == null || ICE.test(nm(b))) return false
  }
  return true
}
/** Every cell a plan places, as "x,y,z" keys (the tidy's dig guard; the tripwire's marker cells). Pure. */
export const designCellKeys = steps => (steps ?? []).map(s => key(s.cell))
/** The plan's footprint (+ margin) as a reservation zone, or null. Pure. */
export function designZone (steps, m = 1, why = 'expedition:bridge') {
  if (!steps?.length) return null
  const xs = steps.map(s => s.cell[0]), zs = steps.map(s => s.cell[2])
  return { box: [Math.min(...xs) - m, -64, Math.min(...zs) - m, Math.max(...xs) + m, 320, Math.max(...zs) + m], why }
}
/** A design's one-line detail for the rows. Pure. */
export const designDetail = d => `style=${d?.style ?? '-'} ${Object.entries(d?.v ?? {}).map(([k, x]) => `${k}=${x}`).join(' ')}`.trim()

// ---- the crossing observer and the traffic sites ------------------------------------------------------------------------------
export const CROSS_WET_MAX_MS = 120_000   // a swim longer than this is not a crossing
export const CROSS_MIN = 4                // dry to dry at least this far (straight line): a shore wade is not a crossing
export const TRAFFIC_R = 160              // only crossings this near home make a town site
export const TRAFFIC_MIN = 8              // crossings at one spot ...
export const TRAFFIC_BOTDAYS = 3          // ... by at least this many distinct bot-days make a site
export const TRAFFIC_CLUSTER_R = 8
export const TRAFFIC_DAYS = 14
/**
 * ONE SAMPLE of a bot's crossing watch -> { state, transit }. Pure. `sample` { t, cell: [x, y, z] (feet), wet, ground }: a dry grounded
 * sample is the last shore; entering the water starts a swim from it; reaching dry ground again ends it, and a swim of at most
 * CROSS_WET_MAX_MS from a shore at least CROSS_MIN away (straight line) is a transit { from, to, wetMs }.
 */
export function crossStep (state = {}, sample = {}) {
  const st = { ...state }
  let transit = null
  if (sample.wet) {
    if (!st.wetSince && st.shore) { st.wetSince = sample.t; st.from = st.shore }
  } else if (sample.ground) {
    if (st.wetSince && st.from) {
      const wetMs = sample.t - st.wetSince
      const d = Math.hypot(sample.cell[0] - st.from[0], sample.cell[2] - st.from[2])
      if (wetMs <= CROSS_WET_MAX_MS && d >= CROSS_MIN) transit = { from: st.from, to: sample.cell, wetMs }
    }
    st.wetSince = null; st.from = null; st.shore = sample.cell
  }
  return { state: st, transit }
}
/**
 * THE TRAFFIC SITES DUE -> [{ mid: [x, z], dir: [dx, dz], n, botDays }]. Pure. The town's `cross` lines of the last TRAFFIC_DAYS within
 * TRAFFIC_R of home, clustered by their midpoints (TRAFFIC_CLUSTER_R, direction folded); a cluster of TRAFFIC_MIN crossings by
 * TRAFFIC_BOTDAYS distinct bot-days with no bridge site end within 2 * TRAFFIC_CLUSTER_R is due, the busiest first.
 */
export function trafficDue (lines = [], { now = Date.now(), home = { x: 0, z: 0 }, sites = [] } = {}) {
  const cl = []
  for (const l of lines) {
    if (l?.op !== 'cross' || !Array.isArray(l.from) || !Array.isArray(l.to)) continue
    if (now - (Number(l.t) || 0) > TRAFFIC_DAYS * 86_400_000) continue
    const mx = (l.from[0] + l.to[0]) / 2, mz = (l.from[2] + l.to[2]) / 2
    if (Math.hypot(mx - home.x, mz - home.z) > TRAFFIC_R) continue
    let c = cl.find(q => Math.hypot(q.mx - mx, q.mz - mz) <= TRAFFIC_CLUSTER_R)
    if (!c) { c = { mx, mz, n: 0, bd: new Set(), dx: 0, dz: 0 }; cl.push(c) }
    c.n++
    c.mx += (mx - c.mx) / c.n; c.mz += (mz - c.mz) / c.n
    c.bd.add(`${l.by}:${new Date(Number(l.t) || 0).toISOString().slice(0, 10)}`)
    const dx = l.to[0] - l.from[0], dz = l.to[2] - l.from[2], L = Math.hypot(dx, dz) || 1
    const sgn = dx * c.dx + dz * c.dz >= 0 ? 1 : -1
    c.dx += (sgn * dx) / L; c.dz += (sgn * dz) / L
  }
  const near = (c, s) => [s?.span?.near, s?.span?.far].some(p => Array.isArray(p) && Math.hypot(p[0] - c.mx, p[2] - c.mz) <= 2 * TRAFFIC_CLUSTER_R)
  return cl.filter(c => c.n >= TRAFFIC_MIN && c.bd.size >= TRAFFIC_BOTDAYS && !sites.some(s => near(c, s)))
    .sort((a, b) => b.n - a.n)
    .map(c => ({ mid: [Math.round(c.mx), Math.round(c.mz)], dir: [c.dx, c.dz], n: c.n, botDays: [...c.bd].sort() }))
}
/**
 * THE SPAN AT A TRAFFIC SITE -> { ok, span, tried } | { ok: false, why, tried }. Pure. Every standable near stand within `r` of the
 * cluster's midpoint whose next column along the crossing's main axis (either way) is water: its designSpan, which must pass the
 * midpoint (laterally within 4, the midpoint between its ends) and have a style; the narrowest wins, then the fewest islets, then
 * the nearest to the midpoint.
 */
export function trafficSpan (read, due, { r = 12, zones = [], yTop = 90, yBot = 50 } = {}) {
  const [cx, cz] = due.mid
  const main = Math.abs(due.dir[0]) >= Math.abs(due.dir[1]) ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]]
  const tried = {}
  let best = null
  const all = []
  for (let ox = -r; ox <= r; ox++) for (let oz = -r; oz <= r; oz++) {
    const x = cx + ox, z = cz + oz
    for (let y = yTop; y >= yBot; y--) {
      const g = read(x, y - 1, z)
      if (g == null) break
      if (!solid(g)) continue
      if (!standable(read, x, y, z)) break
      for (const axis of main) {
        const n1 = read(x + axis[0], y - 1, z + axis[1]), n2 = read(x + axis[0], y - 2, z + axis[1])
        if (!isWater(n1) && !isWater(n2)) continue
        const s = designSpan(read, [x, y, z], axis, { zones })
        if (!s.ok) { tried[s.why] = (tried[s.why] ?? 0) + 1; continue }
        const lat = axis[0] ? Math.abs(z - cz) : Math.abs(x - cx)
        const a0 = axis[0] ? x : z, a1 = axis[0] ? s.far[0] : s.far[2], am = axis[0] ? cx : cz
        if (lat > 4 || am < Math.min(a0, a1) - 2 || am > Math.max(a0, a1) + 2) { tried.off_line = (tried.off_line ?? 0) + 1; continue }
        if (!stylesFor(s).length) { tried.no_style = (tried.no_style ?? 0) + 1; continue }
        const sc = [s.w, s.islets, Math.hypot(ox, oz)]
        if (!all.some(q => q.s.near.join(',') === s.near.join(',') && q.s.axis.join(',') === s.axis.join(','))) all.push({ s, sc })
        if (!best || sc[0] < best.sc[0] || (sc[0] === best.sc[0] && (sc[1] < best.sc[1] || (sc[1] === best.sc[1] && sc[2] < best.sc[2])))) best = { s, sc }
      }
      break
    }
  }
  // every candidate, best first (the caller tries a design on each: the narrowest line may not fit a body beside it)
  all.sort((a, b) => a.sc[0] - b.sc[0] || a.sc[1] - b.sc[1] || a.sc[2] - b.sc[2])
  return best ? { ok: true, span: best.s, spans: all.slice(0, 12).map(q => q.s), tried } : { ok: false, why: 'no_span', tried }
}
/** The bearing (0..7; expedition.mjs bearingVec: k * 45 degrees, dx = cos, dz = sin) from home to a point [x, y, z]. Pure. */
export const bearingTo = (home, p) => ((Math.round(Math.atan2(p[2] - home.z, p[0] - home.x) / (Math.PI / 4)) % 8) + 8) % 8
