// TOWNSTYLE-03: THE RETROFIT -- the standing flat-roofed buildings get pitched roofs, ONE AT A TIME (control session 11-05 for the owner:
// "retrofit flat roofs one building at a time"; O3 "one roofed building at a time so the tree farm keeps up"; design
// docs/reports/townstyle-design-2026-11-04.md section 10). PURE: which building is next, and the new record generation that adds its roof.
//
// NOTHING IS DUG. The new generation keeps EVERY cell of the standing record, where and what it is (townstyle.mjs restyleRoof
// `keepFlat`: the old flat roof becomes the ceiling under the new one), and adds the pitched roof above it -- so the contents, the doors,
// the signs and the stations never change, and the tripwire judges the new roof's placements as cells of the head record (G1) like any
// build. The record keeps its blueprint id (every module that keys on it -- the storage hall's clerk, the copper hall's domain -- is
// unchanged) and gains `style` (chosen once, from the town's known stock), its own resolved `palette`, and `restyle` (the generation's
// tag). The new roof's cells are proven from the world as it stands (buildsite.mjs proveSite over the added cells only).
// REROOF=off is the kill switch (a published generation stays: its open cells are an ordinary repair). On in REROOF_POOLS ('showcase').

import { restyleRoof, styleOf, stylePalette } from './townstyle.mjs'
import { placeBlueprint } from './buildsite.mjs'   // reroof-02: the pending retrofits' world cells (the decorator keeps off them)
import { replaceableCell, rot } from './townplan.mjs'
import { digStand, foreignKind } from './buildrun.mjs'   // reroof-02 (b): the visit's own dig rules, asked by the proof
import { walkFrom, overlay, stepFor } from './buildsite.mjs'

export const REROOF_PLOT = 'reroof'
/** The targets in order (smallest first: a stalled roof costs least there) and their roof form. */
export const REROOF_TARGETS = Object.freeze([
  Object.freeze({ plot: 'house1', blueprint: 'house@1', form: 'gable' }),
  Object.freeze({ plot: 'shop', blueprint: 'workshop@1', form: 'gable' }),
  Object.freeze({ plot: 'storehub', blueprint: 'storehub@1', form: 'slab' }),
  Object.freeze({ plot: 'hall', blueprint: 'hall@1', form: 'slab' }),
  Object.freeze({ plot: 'enchantshop', blueprint: 'enchantshop@1', form: 'slab' }),
])
/** The style's needs per form (the roof's logs with a margin, the walls' wood unused: the walls stand). */
export const REROOF_NEED = Object.freeze({ gable: Object.freeze({ roof: 24, wall: 0, stone: 0 }), slab: Object.freeze({ roof: 48, wall: 0, stone: 0 }) })

const onOff = v => { const s = String(v ?? '').trim().toLowerCase(); return ['on', '1', 'true', 'yes'].includes(s) ? true : ['off', '0', 'false', 'no'].includes(s) ? false : null }
/** THE SWITCH -> { on }. REROOF=on|off; unset = on only in REROOF_POOLS (default 'showcase'). Pure. */
export function reroofSwitches (env = process.env, pool = '') {
  const pools = String(env?.REROOF_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return { on: onOff(env?.REROOF) ?? pools.includes(String(pool)) }
}
/** Is a record styled (a style chosen at siting or by a retrofit)? Pure. */
export const isStyled = rec => !!(rec?.style && typeof rec.style === 'object')
/**
 * THE NEXT BUILDING -> { target, why } | { target: null, why }. Pure. `records` { plot: rec | null }. ONE AT A TIME: nothing while any
 * styled record is still open (a cottage, the town hall, an earlier retrofit). Then the first target, in order, whose record is COMPLETE,
 * still on its target blueprint and not yet styled; `logs` the town's known log count (null: unknown -> wait).
 */
export const REROOF_FAILS_MAX = 3
export function reroofNext (records = {}, { logs = null, targets = REROOF_TARGETS, damaged = () => false, failed = {}, now = Date.now(), fresh = false } = {}) {
  // OPEN: a styled build not complete (a cottage, the town hall), or a retrofit generation whose added roof is not all done yet (it stays
  // `structure_complete` -- the building keeps its stations, its clerk, its fit-out -- so its open roof is read as DAMAGE: Claude r1 note 1)
  const open = Object.entries(records).find(([, r]) => isStyled(r) && (!r.structure_complete || (!!r.restyle && damaged(r))))
  if (open) return { target: null, why: `styled_open:${open[0]}` }
  if (logs == null) return { target: null, why: 'stock_unknown' }
  for (const t of targets) {
    const r = records[t.plot]
    if (!r || !r.structure_complete || isStyled(r) || r.blueprint !== t.blueprint) continue
    // a building whose added roof failed its proof REROOF_FAILS_MAX times is passed over (named), never the queue's end (Claude r1 note 3)
    if (reroofFailCount(failed?.[t.plot], { now, fresh }) >= REROOF_FAILS_MAX) continue
    if (logs < REROOF_NEED[t.form].roof) return { target: null, why: `logs_${logs}<${REROOF_NEED[t.form].roof}:${t.plot}` }
    return { target: t, why: 'ok' }
  }
  return { target: null, why: 'none' }
}
/** The retrofit blueprint of a target: the standing blueprint with the roof added above its flat one. Pure. */
export const reroofBlueprint = (bp, form) => restyleRoof(bp, { id: `${bp.id}r`, form, keepFlat: true })
/**
 * THE ADDED CELLS -> the retrofit blueprint's cells that are not the standing blueprint's (by local position). Pure. Their local
 * blueprint (cells, segments, palette, interior) is what buildsite.mjs proveSite proves on the standing world.
 */
export function reroofAdded (bpOld, bpNew) {
  const old = new Set(bpOld.cells.map(c => `${c.u},${c.v},${c.y}`))
  return bpNew.cells.filter(c => !old.has(`${c.u},${c.v},${c.y}`))
}
/**
 * THE PROOF'S BLUEPRINT for the added roof -> { ...bpNew, cells: added, segments: the new roof's, palette (styled), interior }. Pure. The
 * interior is the standing blueprint's LESS every cell that blueprint fills (its chests, furnaces, tables: proveSite counts only the
 * proof's own cells as solid inside -- Claude r1 BLOCKER 1: the shop, both halls and the enchanting workshop failed interior_unreachable).
 */
export function reroofProofBlueprint (bpOld, bpNew, style, { occupied = () => false } = {}) {
  // ...and the enchanting workshop's FIT-OUT slots (its anvil, table and shelves stand there: never record cells -- Codex r4 BLOCKER 1)
  const filled = new Set([...bpOld.cells, ...(bpOld.fit ?? [])].map(c => `${c.u},${c.v},${c.y}`))
  // reroof-02 (d, REROOF_DOORSTEP): and every interior cell a block now stands in (`occupied(u, v, y)`: the town plan's chests and
  // stations inside a building are no record cells -- LIVE 11-05: the workshop's two chests made its interior 8/10 reachable)
  return {
    ...bpNew,
    cells: reroofAdded(bpOld, bpNew),
    segments: (bpNew.segments ?? []).filter(s => ['gable', 'roof-edge', 'roof-inner'].includes(s.seg)),
    palette: stylePalette(bpNew.palette, style),
    interior: (bpOld.interior ?? []).filter(([u, v, y]) => !filled.has(`${u},${v},${y}`) && !occupied(u, v, y)),
  }
}
/** The style a retrofit takes (the walls stand: only the roof's wood is chosen; the stone is kept as built). Pure. */
export const reroofStyle = (town = {}, { pool = '', plot = '', form = 'gable' } = {}) => styleOf(town, { key: `${pool}/reroof/${plot}`, need: REROOF_NEED[form], variants: ['r'] })
/**
 * THE NEW GENERATION -> the record to publish. Pure. `rec` the standing (complete) record; `added` the proven added cells with their
 * world positions (proveSite's `cells`: at, role, seg, stand, support, face, ws, blind); `bpNew` the retrofit blueprint; `style`.
 * Every old cell, unchanged and in order; the added cells after them; the segments: the old ones with the old roof's renamed `ceiling`
 * (its cells keep their old segment names: they are done), then the new roof's; the record's own palette (the old roles exactly as the
 * blueprint had them, the new roles resolved); `restyle` the tag; open again.
 */
export function reroofRecord (rec, added, bpNew, style, { now = Date.now(), clear = [] } = {}) {
  // the old segments stay as they are (their cells are done, the flat roof's included); the NEW roof's segments are `reroof-*`, the
  // first after the old flat roof (complete in the world), so the two never mix
  const segs = (rec.segments ?? []).map(s => ({ ...s }))
  const ren = s => `reroof-${s}`
  const flat = segs.some(s => s.seg === 'roof-inner') ? ['roof-inner'] : []
  // reroof-02 (d): a proven DOORSTEP is the proof's `earth` segment (role fill, cobblestone): built first, every roof segment after it
  const step = added.some(c => c.seg === 'earth') ? [{ seg: ren('earth'), layer: -1, deps: [] }] : []
  const newSegs = [...step, ...(bpNew.segments ?? []).filter(s => ['gable', 'roof-edge', 'roof-inner'].includes(s.seg)).map(s => ({ ...s, seg: ren(s.seg), deps: [...(s.seg === 'gable' ? flat : (s.deps ?? []).map(ren)), ...step.map(x => x.seg)] }))]
  const palette = { ...stylePalette(bpNew.palette, style) }
  return {
    ...rec,
    cells: [...rec.cells, ...added.map(c => ({ ...c, seg: ren(c.seg) }))],
    // reroof-02 (b): what stands in the new roof's cells, dug first by the building's own visit (runVisit's clears: low before high)
    ...(clear.length ? { clear: [...(rec.clear ?? []), ...clear.map(c => ({ at: c.at.slice(), kind: c.kind, name: c.name }))] } : {}),
    segments: [...segs, ...newSegs],
    // still COMPLETE (Claude r1 note 1: an open record turns off the workshop's stations, the hall's clerk, the enchanting fitter and
    // every project `after` it): the added cells read open, so the record reads DAMAGED and the building's own visit repairs it -- the
    // order's repairs-first
    palette, style: { ...style }, restyle: { id: bpNew.id, at: now, added: added.length },
  }
}

// ---- REROOF-02 (11-06; the showcase retrofit out of candidates: 9 of 9 visits no_site, reroof.failed.json house1 3 / shop 3 /
// storehub 3) -----------------------------------------------------------------------------------------------------------------------
// MEASURED (11-05 14:10Z..21:51Z, 9 visits, 916,871 skill rows walked): house1 3 x `cell_not_free lantern@-33,72,-8`, storehub 3 x
// `lantern@22,73,-49` (decorator-03's lantern posts, placed 06:06Z and 09:12Z, stand under the new roof's eaves: roof-edge cells), shop 3 x
// `no_step gable 1 left, first gable@27,77,29`. Replayed offline on the 01:15Z world (the same three answers): with the lanterns gone the
// next blocker is TREE CANOPY (house1 7 spruce_leaves, storehub 27); the workshop's interior is never walked to (its doorway's front
// stands 2 above the end of path P-shop-3) -- its east apex's nearest stand is outside, 4.81 from the face (REACH 4.5), and with
// the reach alone 15 roof-inner cells have no stand either.
//   (a) REROOF_DECOR_AVOID   the decorator never sites an ornament on a cell a pending retrofit will add (reroofPendingCells)
//   (b) REROOF_DECOR_CLEAR   a decorator ornament standing in an added cell is retired from the decor record and dug by the building's
//                            visit (`_build op=clear kind=decor_post`): the post's fence and lantern together; the decorator re-sites
//                            its posts at legal spots (its ordinary posts batch, which (a) keeps off the new roof)
//       REROOF_CLUTTER_CLEAR tree LEAVES and a scaffold-class block (buildrun.mjs foreignKind: dirt, cobble, stone, a crafting table)
//                            that are no record's cell, standing in an added cell, are dug the same way (`kind=leaves` / `kind=foreign`)
//                            -- LIVE 11-05: house1's roof-edge -38,73,-3 holds a floating dirt; logs never (a felling owes saplings)
//                            -- and every listed dig must have a DIG STAND from the town walk (buildrun.mjs digStand), else the proof
//                            fails `clear_unreached` naming it (storehub: 14 canopy leaves over its flat roof no stand reaches)
//   (c) REROOF_FAILS_FRESH   the failure counts are versioned and expire: the release starts fresh, a pass-over lasts REROOF_FAILS_TTL_MS
//   (d) REROOF_DOORSTEP      a doorway whose front stands 2 above the walk in front of it gets a DOORSTEP (one fill cell, cobblestone,
//                            the proof's first segment), and the interior check skips cells a block now stands in (the town's chests)
// Each REROOF_<X>=off is its own rollback; REROOF=off still turns the whole retrofit off.
const offs = v => /^(off|0|false|no)$/i.test(String(v ?? '').trim())
/** THE FIXES' SWITCHES -> { avoid, decor, leaves, fresh, doorstep }. Default on. Pure. */
export function reroofFixes (env = process.env) {
  return { avoid: !offs(env?.REROOF_DECOR_AVOID), decor: !offs(env?.REROOF_DECOR_CLEAR), clutter: !offs(env?.REROOF_CLUTTER_CLEAR),
    fresh: !offs(env?.REROOF_FAILS_FRESH), doorstep: !offs(env?.REROOF_DOORSTEP),
    // reroof-03 (11-08): a log on the building (a tree rooted on its own roof, a felled tree's floating remains) is dug (e); a dig no
    // ground stand reaches is proven reachable from the new roof's own placed cells, in the build's order (f)
    roofTree: !offs(env?.REROOF_ROOFTREE), ordered: !offs(env?.REROOF_ORDERED) }
}
export const REROOF_FIX = Object.freeze(reroofFixes(typeof process !== 'undefined' ? process.env : {}))
/** The `_reroof_mode` licence row. Pure. */
export const reroofModeDetail = (on, fx) => `on=${on ? 1 : 0} v=2 avoid=${fx.avoid ? 1 : 0} decor=${fx.decor ? 1 : 0} clutter=${fx.clutter ? 1 : 0} fresh=${fx.fresh ? 1 : 0} doorstep=${fx.doorstep ? 1 : 0} rooftree=${fx.roofTree ? 1 : 0} ordered=${fx.ordered ? 1 : 0} fails_max=${REROOF_FAILS_MAX} fails_ttl_h=${REROOF_FAILS_TTL_MS / 3_600_000}`

/** (c) A pass-over lasts this long after the building's LAST failed proof: the world around it changes (a tree felled, a post moved). */
export const REROOF_FAILS_TTL_MS = 6 * 60 * 60_000
export const REROOF_FAILS_V = 2
/**
 * (c) ONE BUILDING'S FAILURE COUNT -> n. Pure. `fresh` off: the file's plain number (as before). `fresh` on: only a versioned entry
 * { v: REROOF_FAILS_V, n, at } counts (the release starts fresh: the old plain numbers -- 3, 3, 3 -- read 0), and it reads 0 once
 * REROOF_FAILS_TTL_MS have passed since `at`.
 */
export function reroofFailCount (entry, { now = Date.now(), fresh = false, ttlMs = REROOF_FAILS_TTL_MS } = {}) {
  if (!fresh) return Number(typeof entry === 'object' && entry ? entry.n : entry) || 0
  if (!entry || typeof entry !== 'object' || entry.v !== REROOF_FAILS_V) return 0
  if (!Number.isFinite(entry.at) || now - entry.at >= ttlMs) return 0
  return Math.max(0, Number(entry.n) || 0)
}
/** (c) The entry after one more failed proof. Pure. fresh off: a plain number (as before). */
export function reroofFailBump (entry, { now = Date.now(), fresh = false, ttlMs = REROOF_FAILS_TTL_MS } = {}) {
  if (!fresh) return (Number(typeof entry === 'object' && entry ? entry.n : entry) || 0) + 1
  return { v: REROOF_FAILS_V, n: reroofFailCount(entry, { now, fresh, ttlMs }) + 1, at: now }
}

/**
 * (a) THE CELLS THE PENDING RETROFITS WILL ADD -> Set of 'x,y,z'. Pure. Every target whose record stands (any state) on its target
 * blueprint and is not styled yet: its retrofit blueprint's added cells at the record's anchor, pad and orientation. `bpOf(id)` loads a
 * blueprint (null: skipped).
 */
export function reroofPendingCells (records = {}, { bpOf = () => null, targets = REROOF_TARGETS } = {}) {
  const out = new Set()
  for (const t of targets) {
    const r = records?.[t.plot]
    if (!r || isStyled(r) || r.blueprint !== t.blueprint || !Array.isArray(r.anchor) || !Number.isFinite(r.s) || !r.orient) continue
    let bp = null
    try { bp = bpOf(t.blueprint) } catch { bp = null }
    if (!bp?.cells) continue
    const add = reroofAdded(bp, reroofBlueprint(bp, t.form))
    for (const c of placeBlueprint({ cells: add }, { x: r.anchor[0], z: r.anchor[1] }, r.s, r.orient)) out.add(c.at.join(','))
  }
  return out
}

const nmOf = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const LEAVES_RX = /_leaves$/
/** A decorator ornament role (decorator.mjs: D<n>-f<k>, D<n>-g, D<n>-pot, D<n>-h, D<n>-post, D<n>-lamp). */
export const DECOR_ORNAMENT_RX = /^D\d+-(f\d|g|u\d|pot|h|post|lamp)$/   // flowers-01: an upgraded border cell (u) too
const LOG_RX = /_(log|wood)$/
/** reroof-03: the clear kind of a roof tree's or a felled tree's remains' logs. NOT `tree`: no sapling is owed (a sapling that took on a
 *  roof, a trunk already felled) -- runVisit's clears() never holds it for a replant, and the tripwire's G5 counts only kind=tree; it is
 *  a listed clear of the head (G2's default rule). */
export const REROOF_REMAINS = 'remains'
const AIR_RX = /^(air|cave_air)$/
/** A reader's block is NATURAL leaves (persistent false; unread properties: not natural, never listed). Pure. */
export function naturalLeafBlock (b) {
  if (!b || !LEAVES_RX.test(nmOf(b))) return false
  const p = b.props
  return p?.persistent === false || p?.persistent === 'false'
}
export const ROOFTREE_MAX = 16     // logs a roof tree may have (the hall's spruce: 6; a giant is no roof tree)
export const ROOFTREE_R = 2        // its canopy: natural leaves within 2 (x/z) of a trunk log, from its bottom to two above its top
/**
 * reroof-03 (e): THE TREE ON THE BUILDING at a log -> { logs: [[x,y,z]] bottom up, leaves: [[x,y,z]], why: 'rooted'|'floating' } | null.
 * Pure. The log's column down to its lowest log; under it either one of the building's OWN cells (`own`: Set of 'x,y,z' -- the flat
 * roof a sapling took on: LIVE 11-08 the hall's spruce -11,70..75,29 on its roof planks at 69) or AIR (a felled tree's remains left
 * floating: the enchanting workshop's 26,73..75,-69 over air at 72) -- anything else (the ground: a living tree beside the building,
 * whose felling owes a sapling) -> null. The column up to its top log; more than ROOFTREE_MAX -> null. Its canopy: natural leaves
 * (naturalLeafBlock) within ROOFTREE_R of the trunk, from its bottom to 2 above its top, that are no record's cell.
 */
export function roofTree (read, at, { own = new Set(), recordAt = () => null, max = ROOFTREE_MAX, r = ROOFTREE_R } = {}) {
  const isLog = (x, y, z) => LOG_RX.test(nmOf(read(x, y, z)))
  if (!Array.isArray(at) || !isLog(...at)) return null
  const [x, , z] = at
  let lo = at[1], hi = at[1]
  while (isLog(x, lo - 1, z) && hi - lo < max) lo--
  while (isLog(x, hi + 1, z) && hi - lo < max) hi++
  if (hi - lo + 1 > max || isLog(x, lo - 1, z) || isLog(x, hi + 1, z)) return null
  const under = read(x, lo - 1, z)
  const why = own.has(`${x},${lo - 1},${z}`) ? 'rooted' : under && AIR_RX.test(nmOf(under)) ? 'floating' : null
  if (!why) return null
  const logs = []
  for (let y = lo; y <= hi; y++) logs.push([x, y, z])
  const leaves = []
  for (let y = lo; y <= hi + 2; y++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    const q = [x + dx, y, z + dz]
    if (own.has(q.join(',')) || recordAt(...q)) continue
    if (naturalLeafBlock(read(...q))) leaves.push(q)
  }
  return { logs, leaves, why }
}
export const REROOF_GROW_MAX = 160   // digs the canopy round unreached ones may add (the live storehub's spruce remains: ~70)
export const REROOF_GROW_ROUNDS = 4
/**
 * reroof-03 (g): THE CANOPY ROUND DIGS NO STAND REACHES -> { clear, added, rounds, rc }. Pure. LIVE 11-08: the storehub's 5 unreached
 * leaves sit inside the canopy of a felled spruce's FLOATING remains beside its west wall (logs 9,72,-53 and 9,75..76,-53 over air):
 * the canopy outside the new roof's cells is never listed and hides them from every stand. While `reach(list)` leaves digs unreached,
 * round each one (within `r`): a log of a tree on the building or a floating remains (roofTree) is listed whole (kind remains) with its
 * leaves, and
 * the natural leaves within 1 are listed; never a record's cell (`recordAt`, `own`); at most REROOF_GROW_MAX added.
 */
export function reroofCanopyGrow (read, clear = [], reach, { own = new Set(), recordAt = () => null, r = 2, max = REROOF_GROW_MAX, rounds = REROOF_GROW_ROUNDS } = {}) {
  const k = a => a.join(',')
  let list = clear.slice(), added = 0, i = 0
  let rc = reach(list)
  for (; i < rounds && !rc.ok && added < max; i++) {
    const have = new Set(list.map(c => k(c.at))), add = []
    const put = (q, kind) => { if (have.has(k(q)) || own.has(k(q)) || recordAt(...q) || added + add.length >= max) return; const b = read(...q); if (!b) return; have.add(k(q)); add.push({ at: q.slice(), name: nmOf(b), kind }) }
    for (const u of rc.unreached) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const q = [u[0] + dx, u[1] + dy, u[2] + dz]
        const b = read(...q)
        if (LOG_RX.test(nmOf(b)) && !have.has(k(q)) && !recordAt(...q)) {
          const tr = roofTree(read, q, { own, recordAt })
          if (tr) { for (const l of tr.logs) put(l, REROOF_REMAINS); for (const l of tr.leaves) put(l, 'leaves') }
        } else if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) <= 1 && naturalLeafBlock(b)) put(q, 'leaves')
      }
    }
    if (!add.length) break
    added += add.length
    list = [...list, ...add].sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])
    rc = reach(list)
  }
  return { clear: list, added, rounds: i, rc }
}
/**
 * reroof-03 (f): CAN EVERY LISTED DIG BE MADE IN THE BUILD'S OWN ORDER? -> { ok, unreached: [[x,y,z]], placed, passes }. Pure.
 * LIVE 11-08: storehub `clear_unreached 5/32` (leaves under the canopy over its flat roof) and, with (e), the hall's roof tree: no
 * GROUND stand reaches them, but the new roof's own cells do once they stand. The visit works the same way (buildrun.mjs runVisit:
 * clears() first, then the segments -- a cell still holding a listed block waits, the cells beside it are placed, the visit ends
 * `blocked`, and the next visit's clears() digs from the cells now standing). Simulated: passes of (1) every listed dig a stand
 * reaches now (digStand over the town walk, low before high), then (2) every proven roof cell (`cells`: proveSite's, in its order)
 * that is free now, has no open cell below it in its column, and has a step now (stepFor over the walk with the placed cells as
 * floors and the cells still to place as obstacles; the digs' walk, like runVisit clears()', blocks nothing) -- until nothing moves. ok: every dig made (the cells left are the proof's own).
 *   wantOf(c) -> stepFor's `want` for a state-bearing or reach-only cell (null: any face)
 */
export function reroofOrderedReach (read, home, clear = [], cells = [], { stood = [], walkR = 90, domain = null, wantOf = () => null, passes = 40 } = {}) {
  const AIRB = Object.freeze({ name: 'air', boundingBox: 'empty' })
  const SOLIDB = Object.freeze({ name: 'cobblestone', boundingBox: 'block' })
  const k = a => a.join(',')
  const over = new Map(), R = overlay(read, over)
  const undug = new Map(clear.map(c => [k(c.at), c]))
  const open = new Map(cells.map(c => [k(c.at), c]))
  const free = at => { const b = R(...at); return !b || AIR_RX.test(nmOf(b)) || replaceableCell(b) }
  const nodesNow = (block = new Set()) => { const m = new Map(); for (const q of walkFrom(R, home, block, walkR, { stood })) { const [x, y, z] = q.split(',').map(Number); const c = `${x},${z}`; if (!m.has(c)) m.set(c, []); m.get(c).push(y) } return m }
  let placed = 0, pass = 0
  for (; pass < passes && (undug.size || open.size); pass++) {
    let moved = false
    // (1) the clears, low before high
    // (the walk is re-planned only when a dig finds no stand after one landed since the last walk: proveSite's `fresh` rule)
    let nodes = nodesNow(), fresh = true
    for (const c of [...undug.values()].sort((a, b) => a.at[1] - b.at[1])) {
      if (!digStand(R, c.at, nodes)) {
        if (fresh) continue
        nodes = nodesNow(); fresh = true
        if (!digStand(R, c.at, nodes)) continue
      }
      over.set(k(c.at), AIRB); undug.delete(k(c.at)); moved = true; fresh = false
    }
    // (2) the roof cells in the proof's order, sweep after sweep (the walk re-planned between sweeps) while any can be placed
    for (let progress = true; progress;) {
      progress = false
      nodes = nodesNow(new Set(open.keys()))
      for (const c of cells) {
        const key = k(c.at)
        if (!open.has(key) || !free(c.at)) continue
        if ([...open.values()].some(o => o !== c && o.at[0] === c.at[0] && o.at[2] === c.at[2] && o.at[1] < c.at[1])) continue
        if (!stepFor(R, home, c.at, nodes, domain, wantOf(c))) continue
        over.set(key, SOLIDB); open.delete(key); placed++; progress = true; moved = true
      }
    }
    if (!moved) break
  }
  return { ok: undug.size === 0, unreached: [...undug.values()].map(c => c.at.slice()), placed, passes: pass }
}
/**
 * (b) WHAT STANDS IN THE ADDED CELLS, AND WHAT MAY GO -> { clear: [{ at, name, kind }], retire: [[x, y, z]], blocker: { at, name } | null }.
 * Pure. `cells` the added cells' world positions; `decor` the decor HEAD record (its cells: { at, role }); `recordAt(x, y, z)` -> a plot
 * whose record holds that cell, or null (any record, the decor's included); `fx` reroofFixes. For every added cell whose block is not
 * free (townplan replaceableCell or air):
 *   - a DECOR ORNAMENT cell holding a block (fx.decor): dug (kind decor_post) and retired, with its post partner (a lamp's fence below, a
 *     fence's lamp above) when that partner holds a block -- one ornament goes whole
 *   - tree LEAVES, or a scaffold-class block (buildrun.mjs foreignKind 'scaffold'), that are no record's cell (fx.clutter): dug (kind
 *     leaves / foreign). Never a log: felling a tree owes its saplings (the read's G5)
 *   - anything else: the blocker (the first, in the cells' order): the proof fails as before, naming it
 * The clear list is ordered low before high (runVisit digs it so).
 */
export function reroofObstacles (read, cells = [], { decor = null, recordAt = () => null, fx = reroofFixes({}), own = null } = {}) {
  const k = a => a.join(',')
  // ...and its cells a RETROFIT already retired (Codex r1 BLOCKER: the decor generation is published first; a visit that stopped before
  // the building's was published must find the same ornament again on the next try, else it is a blocker for good)
  const roleAt = new Map([...(decor?.retired ?? []).filter(c => Array.isArray(c?.at) && /^reroof:/.test(String(c.by ?? ''))), ...(decor?.cells ?? []).filter(c => Array.isArray(c?.at))]
    .map(c => [k(c.at), String(c.role ?? '')]))
  const clear = new Map(), retire = new Map()
  const free = b => !b || nmOf(b) === 'air' || nmOf(b) === 'cave_air' || replaceableCell(b)
  const take = (at, kind) => { const b = read(...at); if (!free(b) && !clear.has(k(at))) clear.set(k(at), { at: at.slice(), name: nmOf(b), kind }) }
  for (const at of cells) {
    const b = read(...at)
    if (!b) return { clear: [], retire: [], blocker: { at: at.slice(), name: 'unknown' } }
    if (free(b)) continue
    const role = roleAt.get(k(at))
    if (fx.decor && role && DECOR_ORNAMENT_RX.test(role)) {
      take(at, 'decor_post'); retire.set(k(at), at.slice())
      const m = role.match(/^(D\d+)-(post|lamp)$/)
      if (m) {
        const partner = m[2] === 'lamp' ? [at[0], at[1] - 1, at[2]] : [at[0], at[1] + 1, at[2]]
        const pr = roleAt.get(k(partner))
        if (pr === `${m[1]}-${m[2] === 'lamp' ? 'post' : 'lamp'}`) { take(partner, 'decor_post'); retire.set(k(partner), partner) }
      }
      continue
    }
    if (fx.clutter && !recordAt(...at) && (LEAVES_RX.test(nmOf(b)) || foreignKind(nmOf(b)) === 'scaffold')) { take(at, LEAVES_RX.test(nmOf(b)) ? 'leaves' : 'foreign'); continue }
    // reroof-03 (e): a LOG ON THE BUILDING -- a tree rooted on one of its own cells, or a felled tree's floating remains -- goes whole
    // (kind remains: its trunk bottom up, then its natural leaves); a tree rooted in the ground stays a blocker (felling it owes a sapling)
    if (fx.roofTree && own && LOG_RX.test(nmOf(b)) && !recordAt(...at)) {
      const tr = roofTree(read, at, { own, recordAt })
      if (tr) { for (const l of tr.logs) take(l, REROOF_REMAINS); for (const l of tr.leaves) take(l, 'leaves'); continue }
    }
    return { clear: [], retire: [], blocker: { at: at.slice(), name: nmOf(b) } }
  }
  const order = (a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2]
  return { clear: [...clear.values()].sort(order), retire: [...retire.values()], blocker: null }
}

/**
 * (d) THE DOORSTEP -> [x, y, z] | null. Pure. The doorway's FRONT cell F (the cell outside its lowest doorway cell, at the doorway's
 * feet: the record's anchor, pad and orientation; local v - 1) and the column G in front of it: when F is a standable feet cell
 * (solid below, open at the feet and the head) and G's highest standable feet cell within 3 below F stands EXACTLY 2 below it, with
 * a free cell and two open cells above it, the doorstep is G at that feet height (one block: the walk then climbs 1 + 1). Else null
 * (a doorway already walked to, or one a single block cannot fix).
 */
export function reroofDoorstep (read, rec, bp) {
  if (!Array.isArray(bp?.doorway) || !bp.doorway.length || !Array.isArray(rec?.anchor) || !Number.isFinite(rec?.s) || !rec?.orient) return null
  const solid = b => !!b && b.boundingBox === 'block' && !/^(water|lava)$/.test(nmOf(b))
  const open = b => !!b && b.boundingBox === 'empty' && !/^(water|lava)$/.test(nmOf(b))
  const y0 = Math.min(...bp.doorway.map(c => c[2]))
  const d0 = bp.doorway.filter(c => c[2] === y0).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const mid = d0[Math.floor(d0.length / 2)]
  const W = (u, v) => { const { dx, dz } = rot(rec.orient, u, v); return [rec.anchor[0] + dx, rec.anchor[1] + dz] }
  const fy = rec.s + y0
  const [fx, fz] = W(mid[0], mid[1] - 1), [gx, gz] = W(mid[0], mid[1] - 2)
  if (!solid(read(fx, fy - 1, fz)) || !open(read(fx, fy, fz)) || !open(read(fx, fy + 1, fz))) return null
  for (let y = fy; y >= fy - 3; y--) {
    if (!(solid(read(gx, y - 1, gz)) && open(read(gx, y, gz)) && open(read(gx, y + 1, gz)))) continue
    if (fy - y !== 2) return null
    return open(read(gx, y + 2, gz)) ? [gx, y, gz] : null
  }
  return null
}

/**
 * (b) DOES EVERY LISTED DIG HAVE A STAND? -> { ok, unreached: [[x, y, z]] }. Pure. The town walk from home (and `stood`) over the world
 * with the digs before it applied (low before high, as runVisit digs them), each dig's stand buildrun.mjs digStand's (DIG_REACH, the
 * sight line). A dig no stand reaches would never be made, and the roof cell it holds would never be placed.
 */
export function reroofClearsReached (read, home, clear = [], { stood = [], walkR = 90 } = {}) {
  const AIRB = Object.freeze({ name: 'air', boundingBox: 'empty' })
  const over = new Map(), unreached = []
  const cols = () => { const m = new Map(); for (const k of walkFrom(overlay(read, over), home, new Set(), walkR, { stood })) { const [x, y, z] = k.split(',').map(Number); const c = `${x},${z}`; if (!m.has(c)) m.set(c, []); m.get(c).push(y) } return m }
  let nodes = null
  for (const c of clear) {
    nodes ??= cols()
    if (!digStand(overlay(read, over), c.at, nodes)) { unreached.push(c.at.slice()); continue }
    over.set(c.at.join(','), AIRB); nodes = null
  }
  return { ok: !unreached.length, unreached }
}
