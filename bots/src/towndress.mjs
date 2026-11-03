// TOWNDRESS-01: LIGHTS AND SIGNS FOR THE TOWN (OWNER 11-03 "towndress": lighting + town signs first, then docks/lighthouses, bee
// farms, a museum; "design all using both claude and codex ... implement and deploy where you feel is right").
// Design: docs/reports/towndress-design-2026-11-03.md (Claude + Codex, reconciled).
//
// THE MODEL. A fourth TOWN SINK (sinks.mjs SINK_KINDS 'dress', plot `dress`, blueprint `dress@1`): a growing record whose every
// INSTANCE is a small BATCH of FIXTURES (at most DRESS.fixturesMax, of them at most DRESS.signsMax signposts) dressing what the
// town already built:
//   signpost  beside the path nearest a finished building: a 2-high post, a torch on it, and a WALL SIGN on the post's face toward
//             the path naming the building ("STOREHOUSE / built by Juno / Nov 1")
//   lamp      beside a laid path: a 1-high post and a torch on it, every DRESS.spacing columns or so
//   walltop   a torch on the top of a town-wall column (a crenel: placed from the wall walk)
// Every cell is a record cell (the tripwire judges every placement, the escape guard and the tidy keep them), the zones are each
// fixture's own column + 1 (never a town-wide box: the land plan and the tidy route round a post, not round the town), and the
// posts and lights are built by the ordinary sink visit (buildrun.mjs runVisit). A SIGN cell is skipped by runVisit (`alsoDone`)
// and written by the storehouse's Paper-proven label writer (skills.mjs sortLabelOne: place on the post's face, the editor opens,
// updateSign, the server's text read back) at the start of each dress visit; an unwritten sign is UPKEEP (`due`), never damage.
//
// PURE: the names, the existing-light scan, the candidates, the spacing, the proof, the instance's cells and the gate. Nothing
// here touches a bot or a file.

import { walkFrom, stepFor, overlay, solidFloor } from './buildsite.mjs'
import { isLiquid, isPassable, replaceableCell, isFurniture } from './townplan.mjs'

const k3 = (x, y, z) => `${x},${y},${z}`
const kOf = a => `${a[0]},${a[1]},${a[2]}`
const k2 = (x, z) => `${x},${z}`
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[2] - b[2]))
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2

export const DRESS_KIND = 'dress'
export const DRESS = Object.freeze({
  fixturesMax: 8,        // fixtures an instance (Codex design: "one open batch, capped at eight lights and two signs")
  signsMax: 2,           // signposts an instance
  spacing: 8,            // no two lights (placed, planned, or this batch's) closer than this (Chebyshev, x/z)
  signSpacing: 3,        // a signpost may stand this close to another light (a building's door often has a torch)
  torchMin: 4,           // a batch needs at least this many spare torches (the town's above its reserve + the bag's)
  pathReach: 12,         // a building's signpost: the path column within this of its entrance
  stepMax: 1,            // a post's ground within this of the path beside it
  instancesMax: 12,
})
/** The wall signs a sign cell takes (any wood: the writer crafts from the bag's planks). */
export const WALL_SIGNS = Object.freeze(['spruce_wall_sign', 'oak_wall_sign', 'birch_wall_sign', 'jungle_wall_sign', 'acacia_wall_sign', 'dark_oak_wall_sign',
  'mangrove_wall_sign', 'cherry_wall_sign', 'pale_oak_wall_sign', 'bamboo_wall_sign', 'crimson_wall_sign', 'warped_wall_sign'])
/** A post's stones, best first (billOf takes the first the town stocks): every list ends in cobblestone. */
export const POST_NAMES = Object.freeze(['stone_bricks', 'cobblestone'])
/** Blocks that give light (an existing light counts toward the spacing). */
export const LIGHT_BLOCK = /^(torch|wall_torch|soul_torch|soul_wall_torch|copper_torch|copper_wall_torch|lantern|soul_lantern|[a-z_]*copper_lantern|glowstone|sea_lantern|jack_o_lantern|shroomlight|campfire|soul_campfire|redstone_lamp|[a-z]+_froglight|end_rod|beacon)$/
/** Is a role a dress SIGN cell (`L3-sign`)? Pure. */
export const dressSignRole = role => /^L\d+-sign$/.test(String(role ?? ''))
/** Is a role a dress light (`L3-light`)? Pure. */
export const dressLightRole = role => /^L\d+-light$/.test(String(role ?? ''))

// ---- the names on the signs -------------------------------------------------------------------------------------------------------
/** The building each finished record names (plot -> the sign's first line, <= 15 characters). Pure. */
export const DRESS_NAMES = Object.freeze({
  storehouse: 'STOREHOUSE', shop: 'WORKSHOP', house1: 'HOUSE', hall: 'COPPER HALL', monument: 'ZIGGURAT', yard: 'STOCK YARD',
  treefarm: 'TREE FARM', shaft: 'MINE STAIR', tower: 'WATCHTOWER', shrine: 'SHRINE',
})
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/**
 * A BUILDING'S SIGN -> [line, ...] (at most 4, each <= 15 characters). Pure. The name, who sited it (the bot's name without its
 * pool prefix), and the day it stood (UTC). A field the record does not have is left out, never guessed.
 */
export function signLines (plot, rec) {
  const name = DRESS_NAMES[plot]
  if (!name) return null
  const out = [name]
  const by = String(rec?.sitedBy ?? rec?.by ?? '').replace(/^.*-/, '').slice(0, 9)
  if (by) out.push(`built by ${by}`)
  const t = Number(rec?.completeAt ?? rec?.at)
  if (Number.isFinite(t) && t > 0) { const d = new Date(t); out.push(`${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`) }
  return out.map(s => s.slice(0, 15))
}

// ---- what is lit already ----------------------------------------------------------------------------------------------------------
/** The light blocks in a box ([x0, z0, x1, z1], y0..y1) -> [[x, y, z]]. Pure over `read`; an unread cell is no light. */
export function lightsIn (read, box, y0, y1) {
  const out = []
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) for (let y = y0; y <= y1; y++) { const b = read(x, y, z); if (b && LIGHT_BLOCK.test(nm(b))) out.push([x, y, z]) }
  return out
}
/** The planned light cells of records (any role whose palette is a light, any `light` role) -> [[x, y, z]]. Pure. */
export function plannedLights (records = []) {
  const out = []
  for (const r of records) for (const c of r?.cells ?? []) {
    if (!Array.isArray(c?.at)) continue
    const names = r?.palette?.[c.role]
    if (c.role === 'light' || dressLightRole(c.role) || (Array.isArray(names) && names.some(n => LIGHT_BLOCK.test(n)))) out.push(c.at)
  }
  return out
}

// ---- the ground beside a path -------------------------------------------------------------------------------------------------------
const AIRISH = b => !!b && (nm(b) === 'air' || nm(b) === 'cave_air' || replaceableCell(b))
/** A column's floor near y (y+2 .. y-2): the highest full-cube floor with two clear cells over it -> its y | null. Pure. */
export function floorNear (read, x, z, y) {
  for (let fy = y + 2; fy >= y - 2; fy--) {
    const f = read(x, fy, z), a = read(x, fy + 1, z), h = read(x, fy + 2, z)
    if (!f || !a || !h) return null
    if (isLiquid(f) || isLiquid(a) || /waterlogged/.test(String(f.name ?? ''))) return null
    if (AIRISH(a) && AIRISH(h) && solidFloor(f) && !isFurniture(f)) return fy
    if (!(AIRISH(f) || isPassable(f))) return null   // a solid that is not a floor with room: nothing lower can be reached here
  }
  return null
}
const wetNear = (read, x, y, z) => {
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) for (let dy = -1; dy <= 2; dy++) { const b = read(x + dx, y + dy, z + dz); if (b && (isLiquid(b) || /waterlogged/.test(String(b.name ?? '')))) return true }
  return false
}

// ---- the candidates ------------------------------------------------------------------------------------------------------------------
/** The path columns of a paths record -> Map "x,z" -> { x, y, z } (the surface y). Pure. */
export function pathColumns (paths) {
  const m = new Map()
  for (const c of paths?.cells ?? []) {
    if (!Array.isArray(c?.at)) continue
    const k = k2(c.at[0], c.at[2])
    const q = m.get(k)
    if (!q || c.at[1] > q.y) m.set(k, { x: c.at[0], y: c.at[1], z: c.at[2] })
  }
  return m
}
/**
 * THE CELL GUARD -> { cols, cells, doors }: every record's cell columns (a post never stands in one), every record cell (a light never
 * goes in one), and the columns in front of every DOOR cell (a palette name *_door) and every record's stands. Pure.
 */
export function cellGuard (records = []) {
  const cols = new Set(), cells = new Set(), doors = new Set()
  for (const r of records) for (const c of r?.cells ?? []) {
    if (!Array.isArray(c?.at)) continue
    cols.add(k2(c.at[0], c.at[2])); cells.add(kOf(c.at))
    const names = r?.palette?.[c.role]
    if (/door/.test(String(c.role)) || (Array.isArray(names) && names.some(n => /_door$/.test(n)))) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) doors.add(k2(c.at[0] + dx, c.at[2] + dz))
  }
  // a record's clear and cut lists are its digs: no dress cell stands in one (a visit digs a listed block by its name only, but a
  // later generation may list again)
  for (const r of records) for (const c of [...(r?.clear ?? []), ...(Array.isArray(r?.cut) ? r.cut : [])]) if (Array.isArray(c?.at)) cells.add(kOf(c.at))
  return { cols, cells, doors }
}
const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]]
/**
 * A POST BESIDE A PATH COLUMN p -> { col, ground, post: [[x,y,z]...], light, face } | { why }. Pure. The side column s (a 4-neighbour of
 * p) is no path column and no record column, not in front of a door, not reserved (`reserved(x, z)`), dry, with a floor within
 * DRESS.stepMax of the path; the post's `h` cells and the light above are air (or a plant a placement replaces).
 */
export function postAt (read, p, s, { pathCols, guard, reserved = () => null, h = 1 }) {
  const ks = k2(s[0], s[1])
  if (pathCols.has(ks)) return { why: 'path' }
  if (guard.cols.has(ks)) return { why: 'record' }
  if (guard.doors.has(ks)) return { why: 'door' }
  const why = reserved(s[0], s[1])
  if (why) return { why: `reserved:${String(why).slice(0, 24)}` }
  const g = floorNear(read, s[0], s[1], p.y)
  if (g == null) return { why: 'no_floor' }
  if (Math.abs(g - p.y) > DRESS.stepMax) return { why: 'step' }
  const post = []
  for (let i = 1; i <= h; i++) post.push([s[0], g + i, s[1]])
  const light = [s[0], g + h + 1, s[1]]
  for (const c of [...post, light]) { const b = read(...c); if (!AIRISH(b)) return { why: 'occupied' }; if (guard.cells.has(kOf(c))) return { why: 'record_cell' } }
  if (wetNear(read, s[0], g + 1, s[1])) return { why: 'wet' }
  return { col: [s[0], s[1]], ground: g, post, light }
}
/**
 * THE LAMP CANDIDATES along the laid paths -> [{ kind: 'lamp', post, light, at, d }] (at = the light; d = Chebyshev from home), one
 * per usable side column, nearest home first. Pure.
 */
export function lampCandidates (read, paths, home, { guard, reserved = () => null }) {
  const pathCols = pathColumns(paths)
  const out = [], seen = new Set()
  for (const p of pathCols.values()) for (const [dx, dz] of sides) {
    const s = [p.x + dx, p.z + dz]
    const ks = k2(s[0], s[1])
    if (seen.has(ks)) continue
    seen.add(ks)
    const r = postAt(read, p, s, { pathCols, guard, reserved, h: 1 })
    if (r.why) continue
    out.push({ kind: 'lamp', post: r.post, light: r.light, at: r.light, d: Math.max(Math.abs(s[0] - home.x), Math.abs(s[1] - home.z)) })
  }
  return out.sort((a, b) => a.d - b.d || a.at[0] - b.at[0] || a.at[2] - b.at[2])
}
/**
 * THE WALL-TOP CANDIDATES -> [{ kind: 'walltop', post: [], light, at, d }]: a torch on the top of a wall column (role `wall`, the
 * column's highest record cell, its cell above air and no record cell), in the ring's column order. Pure.
 */
export function wallTopCandidates (read, wall, home, { guard }) {
  if (!wall || !Array.isArray(wall.cells)) return []
  const top = new Map()
  for (const c of wall.cells) {
    if (!Array.isArray(c?.at)) continue
    const k = k2(c.at[0], c.at[2])
    const q = top.get(k)
    if (!q || c.at[1] > q.at[1]) top.set(k, c)
  }
  const out = []
  for (const c of top.values()) {
    if (c.role !== 'wall') continue
    const light = [c.at[0], c.at[1] + 1, c.at[2]]
    if (guard.cells.has(kOf(light))) continue
    const b = read(...light), sup = read(...c.at)
    if (!AIRISH(b) || !sup || sup.boundingBox !== 'block') continue
    if (wetNear(read, light[0], light[1], light[2])) continue
    out.push({ kind: 'walltop', post: [], light, at: light, d: Math.max(Math.abs(light[0] - home.x), Math.abs(light[2] - home.z)) })
  }
  return out.sort((a, b) => a.d - b.d || a.at[0] - b.at[0] || a.at[2] - b.at[2])
}
/**
 * THE SIGNPOST CANDIDATES -> [{ kind: 'signpost', for, post, light, sign: { at, wall, face, stand, lines }, at, d }], one per finished
 * named building (`buildings`: [{ plot, rec }]) that has none yet (`signed`: Set of plots), nearest home first. The ENTRANCE is the
 * record's door cell (a palette name *_door) when it has one, else its cell nearest the path network; the post stands beside the
 * path column nearest the entrance (within DRESS.pathReach), on the side toward the building; it is 2 high, its torch on top, and
 * the sign hangs on the upper post block's face toward the path column, at head height over it (a wall sign has no collision box).
 * The writer's stand is a path column beside that one. Pure.
 */
export function signpostCandidates (read, paths, buildings, home, { guard, reserved = () => null, signed = new Set() }) {
  const pathCols = pathColumns(paths)
  if (!pathCols.size) return []
  const pcs = [...pathCols.values()]
  const out = []
  for (const { plot, rec } of buildings) {
    if (signed.has(plot) || !rec?.structure_complete) continue
    const lines = signLines(plot, rec)
    if (!lines) continue
    const cells = (rec.cells ?? []).filter(c => Array.isArray(c?.at))
    if (!cells.length) continue
    const doors = cells.filter(c => /door/.test(String(c.role)) || (rec.palette?.[c.role] ?? []).some(n => /_door$/.test(n)))
    // the entrance and the path column nearest it
    let best = null
    for (const e of (doors.length ? doors : cells)) for (const p of pcs) { const d = d2(e.at, [p.x, 0, p.z]); if (cheb(e.at, [p.x, 0, p.z]) <= DRESS.pathReach && (!best || d < best.d)) best = { d, e, p } }
    if (!best) continue
    // the path columns nearest the entrance (up to 6), each side column toward the building first
    const near = pcs.filter(p => cheb(best.e.at, [p.x, 0, p.z]) <= DRESS.pathReach).map(p => ({ p, d: d2(best.e.at, [p.x, 0, p.z]) })).sort((a, b) => a.d - b.d || a.p.x - b.p.x || a.p.z - b.p.z).slice(0, 12)
    let got = null
    for (const { p } of near) {
      const cand = sides.map(([dx, dz]) => [p.x + dx, p.z + dz]).sort((a, b) => d2([a[0], 0, a[1]], best.e.at) - d2([b[0], 0, b[1]], best.e.at))
      for (const s of cand) {
        const r = postAt(read, p, s, { pathCols, guard, reserved, h: 2 })
        if (r.why) continue
        const signAt = [p.x, r.post[1][1], p.z]
        if (!AIRISH(read(...signAt)) || guard.cells.has(kOf(signAt))) continue
        // the writer stands on a path column beside the sign's (never in it: a body in the sign cell refuses the place)
        const st = sides.map(([dx, dz]) => pathCols.get(k2(p.x + dx, p.z + dz))).filter(Boolean).find(q => !(q.x === s[0] && q.z === s[1]))
        if (!st) continue
        // the torch: on the post's top when a stand's eye clears it (a raised path), else hung on the post's upper side -- along the
        // path either way, or its back -- the first the proof can place (a ground eye is below a 2-high post's top face)
        const fx = p.x - s[0], fz = p.z - s[1]
        const side = [[fz, fx], [-fz, -fx], [-fx, -fz]].map(([dx, dz]) => [s[0] + dx, r.post[1][1], s[1] + dz])
          .filter(c => !pathCols.has(k2(c[0], c[2])) && !guard.cols.has(k2(c[0], c[2])) && !reserved(c[0], c[2]) && AIRISH(read(...c)))
        got = { post: r.post, light: r.light, lightOpts: [r.light, ...side], sign: { at: signAt, wall: r.post[1], face: [fx, 0, fz], stand: [st.x, st.y + 1, st.z], lines } }
        break
      }
      if (got) break
    }
    if (!got) continue
    out.push({ kind: 'signpost', for: plot, ...got, at: got.light, d: Math.max(Math.abs(got.light[0] - home.x), Math.abs(got.light[2] - home.z)) })
  }
  return out.sort((a, b) => a.d - b.d)
}

// ---- choosing the batch and proving it ------------------------------------------------------------------------------------------------
/**
 * PICK THE BATCH -> [fixture]. Pure. Signposts first (at most DRESS.signsMax), then the lamps and the wall tops interleaved, each at
 * least DRESS.spacing (Chebyshev, x/z) from every light already lit or planned (`lit`) and from the batch's own (a signpost
 * DRESS.signSpacing: a door's own torch does not keep its name off), at most `torches` torches and DRESS.fixturesMax fixtures.
 * `ok(f)` is the proof (each fixture buildable from where a bot can walk).
 */
export function pickBatch ({ signposts = [], lamps = [], walltops = [], lit = [], torches = 0, ok = () => true } = {}) {
  const chosen = []
  const lights = lit.slice()
  const far = (f, gap) => lights.every(l => cheb(l, f.at) >= gap)
  const take = f => { chosen.push(f); lights.push(f.at) }
  const room = () => chosen.length < DRESS.fixturesMax && chosen.length < torches
  for (const f of signposts) { if (!room() || chosen.filter(c => c.kind === 'signpost').length >= DRESS.signsMax) break; if (far(f, DRESS.signSpacing) && ok(f)) take(f) }
  let i = 0, j = 0
  while (room() && (i < lamps.length || j < walltops.length)) {
    // alternate: a lamp, then a wall top (each list nearest home first)
    const useLamp = (chosen.length % 2 === 0 && i < lamps.length) || j >= walltops.length
    const f = useLamp ? lamps[i++] : walltops[j++]
    if (far(f, DRESS.spacing) && ok(f)) take(f)
  }
  return chosen
}
const SOLID = name => Object.freeze({ name, boundingBox: 'block' })
const EMPTY = name => Object.freeze({ name, boundingBox: 'empty' })
/**
 * THE PROOF FOR ONE FIXTURE -> bool. Pure. Its cells in order (the post bottom up, the light) each have a STEP (buildsite.mjs stepFor:
 * a support the builder clicks, the eye within reach on its open side, a clear sight line) from a stand of the town walk `nodes`
 * that is not in the post's own column; a placed cell is a support for the next. A signpost's sign is the label writer's (its stand
 * is checked to be a walk node).
 */
export function proveFixture (read, home, f, nodes, domain = () => true) {
  const over = new Map()
  const R = overlay(read, over)
  const col = f.post.length ? k2(f.post[0][0], f.post[0][2]) : null
  const ns = col ? new Map([...nodes].filter(([k]) => k !== col)) : nodes
  for (const c of f.post) {
    if (!stepFor(R, home, c, ns, domain)) return false
    over.set(kOf(c), SOLID('stone_bricks'))
  }
  // a signpost's torch: the first of its places a step reaches (the fixture keeps it)
  const opts = Array.isArray(f.lightOpts) && f.lightOpts.length ? f.lightOpts : [f.light]
  const light = opts.find(c => !!stepFor(R, home, c, ns, domain))
  if (!light) return false
  f.light = light; f.at = light
  if (f.sign) { const st = f.sign.stand; if (!(nodes.get(k2(st[0], st[2])) ?? []).includes(st[1])) return false }
  return true
}
/** The town walk's nodes by column (buildsite.mjs walkFrom over `read` from home and `stood`, radius walkR). Pure. */
export function walkNodes (read, home, { stood = [], walkR = 64, block = new Set() } = {}) {
  const m = new Map()
  for (const k of walkFrom(read, home, block, walkR, { stood })) { const [x, y, z] = k.split(',').map(Number); const c = k2(x, z); if (!m.has(c)) m.set(c, []); m.get(c).push(y) }
  return m
}

// ---- the instance ---------------------------------------------------------------------------------------------------------------------
/**
 * A BATCH AS AN INSTANCE -> { cells, segments, palette, counts, clear, zones, cols, signs, box }. Pure. One segment a fixture
 * (`L3-P0` ...: no barrier between them, so three builders take three fixtures), its post cells bottom up, its light, a signpost's
 * sign cell (role `L3-sign`: the label writer's, never runVisit's). Zones: each fixture's column + 1 (a wall top: its own column).
 */
export function dressInstance (id, fixtures) {
  const roles = { [`${id}-post`]: POST_NAMES.slice(), [`${id}-light`]: ['torch'], [`${id}-sign`]: WALL_SIGNS.slice() }
  const cells = [], zones = [], cols = [], signs = []
  fixtures.forEach((f, k) => {
    const seg = `${id}-P${k}`
    for (const p of f.post) cells.push({ at: p.slice(), role: `${id}-post`, seg })
    cells.push({ at: f.light.slice(), role: `${id}-light`, seg })
    if (f.sign) { cells.push({ at: f.sign.at.slice(), role: `${id}-sign`, seg }); signs.push({ ...f.sign, for: f.for, seg }) }
    const m = f.post.length ? 1 : 0
    const [x, , z] = f.light
    zones.push({ box: [x - m, -64, z - m, x + m, 320, z + m], why: `project:dress:${id}` })
    cols.push([x, z])
  })
  const xs = cells.map(c => c.at[0]), zs = cells.map(c => c.at[2])
  const segments = fixtures.map((_, k) => ({ seg: `${id}-P${k}`, deps: [] }))
  const counts = cells.reduce((m, c) => (m[c.role] = (m[c.role] ?? 0) + 1, m), {})
  return { cells, segments, palette: roles, counts, clear: [], zones, cols, signs, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] }
}
/** The summary for the sited row: `s2/l4/w2` (signposts, lamps, wall tops) and the names signed. Pure. */
export function dressSummary (fixtures) {
  const n = k => fixtures.filter(f => f.kind === k).length
  const names = fixtures.filter(f => f.for).map(f => f.for).join('+')
  return `s${n('signpost')}/l${n('lamp')}/w${n('walltop')}${names ? `/${names}` : ''}`
}

/**
 * SITE THE NEXT DRESS BATCH -> { ok, inst, meta, tried } | { ok: false, why, tried }. Pure over `read`. ctx:
 *   id, n, home, records [{ plot, rec }] (every OTHER project's head record: the anchors, the cell guard, the planned lights),
 *   rec (the dress record so far: its signed buildings, its cells), torches (spare), reserved(x, z) (protected zones, wells, the
 *   farm, the land plan's corridors, the markers, an unsited hall's pad), stood, walkR.
 */
export function siteDress (read, ctx = {}) {
  const { id, n = 1, home, records = [], rec = null, torches = 0, reserved = () => null, stood = [] } = ctx
  const tried = []
  if (!(torches >= DRESS.torchMin)) return { ok: false, why: 'no_torch', tried }
  const byPlot = new Map(records.filter(r => r?.rec).map(r => [r.plot, r.rec]))
  const paths = byPlot.get('paths') ?? null
  const wall = byPlot.get('wall') ?? null
  const recs = [...records.map(r => r.rec).filter(Boolean), ...(rec ? [rec] : [])]
  const guard = cellGuard(recs)
  const signed = new Set((rec?.instances ?? []).flatMap(i => i.signed ?? []))
  const buildings = records.filter(r => r?.rec && DRESS_NAMES[r.plot])
  const signposts = paths ? signpostCandidates(read, paths, buildings, home, { guard, reserved, signed }) : []
  const lamps = paths ? lampCandidates(read, paths, home, { guard, reserved }) : []
  const walltops = wall ? wallTopCandidates(read, wall, home, { guard }) : []
  tried.push(`s${signposts.length}/l${lamps.length}/w${walltops.length}`)
  const all = [...signposts, ...lamps, ...walltops]
  if (!all.length) return { ok: false, why: 'no_candidates', tried }
  const xs = all.map(f => f.at[0]), zs = all.map(f => f.at[2]), ys = all.map(f => f.at[1])
  const pad = DRESS.spacing
  const lit = [...lightsIn(read, [Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad], Math.min(...ys) - 4, Math.max(...ys) + 3), ...plannedLights(recs)]
  const far = Math.max(...all.map(f => Math.max(Math.abs(f.at[0] - home.x), Math.abs(f.at[2] - home.z))))
  const walkR = Math.max(ctx.walkR ?? 0, Math.min(128, far + 8))
  const nodes = walkNodes(read, home, { stood, walkR })
  let proofs = 0
  const ok = f => { proofs++; return proveFixture(read, home, f, nodes, (x, z) => Math.abs(x - f.at[0]) <= 6 && Math.abs(z - f.at[2]) <= 6) }
  const batch = pickBatch({ signposts, lamps, walltops, lit, torches, ok })
  tried.push(`lit${lit.length} proofs${proofs}`)
  if (!batch.length) return { ok: false, why: 'no_site', tried, proofs }
  const inst = dressInstance(id, batch)
  const meta = { id, n, kind: DRESS_KIND, design: { kind: DRESS_KIND, fixtures: batch.map(f => ({ kind: f.kind, at: f.at, ...(f.for ? { for: f.for } : {}) })) }, summary: dressSummary(batch),
    box: inst.box, zones: inst.zones, cols: inst.cols, signed: batch.filter(f => f.for).map(f => f.for), signs: inst.signs,
    approach: [batch[0].sign?.stand ?? batch[0].light], centre: [batch[0].at[0], batch[0].at[2]], torches: batch.length }
  return { ok: true, inst, meta, tried, proofs }
}

// ---- the gate and the upkeep ------------------------------------------------------------------------------------------------------------
/** THE DRESS "PRESSURE" for sinks.mjs sinkNextGate -> { p, torches, known }: a batch wants DRESS.torchMin spare torches (the town's
 *  above its reserve, read, + the bag's); p 1 when it has them, else -1. An unread town counts only the bag. Pure. */
export function dressPressure ({ townTorch = null, coverage = 0, reserve = 32, bagTorch = 0 } = {}) {
  const known = Number.isFinite(townTorch) && Number(coverage) >= 0.8
  const torches = (known ? Math.max(0, townTorch - reserve) : 0) + Math.max(0, Number(bagTorch) || 0)
  return { p: torches >= DRESS.torchMin ? 1 : -1, torches, known }
}
/** The sign spots of a dress record -> [{ at, wall, face, stand, lines, for, chest }] (`chest` the row's label key). Pure. */
export function dressSignSpots (rec) {
  return (rec?.instances ?? []).flatMap(i => (i.signs ?? []).map(s => ({ ...s, chest: `${i.id}:${s.for}` })))
}
/** The dress row detail (`_dress` rows: op=signs). Pure. */
export const dressRowDetail = f => Object.entries(f).filter(([, v]) => v != null).map(([k, v]) => `${k}=${String(Array.isArray(v) ? v.join(',') : v).replace(/\s+/g, '_').slice(0, 80)}`).join(' ')
