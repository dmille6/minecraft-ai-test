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
import { replaceableCell, rot, isPassable, isLiquid } from './townplan.mjs'
import { digStand, foreignKind } from './buildrun.mjs'   // reroof-02 (b): the visit's own dig rules, asked by the proof
import { walkFrom, overlay, stepFor, proveSite, fullCube, slabTopFloor } from './buildsite.mjs'   // reroof-04: proveSite for the whole proof (reroofProve)

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
export function reroofRecord (rec, added, bpNew, style, { now = Date.now(), clear = [], temp = null, notch = 0 } = {}) {
  // the old segments stay as they are (their cells are done, the flat roof's included); the NEW roof's segments are `reroof-*`, the
  // first after the old flat roof (complete in the world), so the two never mix
  const segs = (rec.segments ?? []).map(s => ({ ...s }))
  const ren = s => `reroof-${s}`
  const flat = segs.some(s => s.seg === 'roof-inner') ? ['roof-inner'] : []
  // reroof-02 (d): a proven DOORSTEP is the proof's `earth` segment (role fill, cobblestone): built first, every roof segment after it
  const step = added.some(c => c.seg === 'earth') ? [{ seg: ren('earth'), layer: -1, deps: [] }] : []
  const newSegs = [...step, ...(bpNew.segments ?? []).filter(s => ['gable', 'roof-edge', 'roof-inner'].includes(s.seg)).map(s => ({ ...s, seg: ren(s.seg), deps: [...(s.seg === 'gable' ? flat : (s.deps ?? []).map(ren)), ...step.map(x => x.seg)] }))]
  // reroof-04: the doorstep's and the temporary stair's role (fill) is always in the palette -- a blueprint without one (storehub@1)
  // left the stair `no_material fill` on Paper 11-08 with 64 cobblestone in the bag
  const styled = stylePalette(bpNew.palette, style)
  const palette = { ...styled, fill: styled.fill ?? ['cobblestone', 'cobbled_deepslate', 'stone'] }
  return {
    ...rec,
    // reroof-04: a TEMPORARY stand's cells (`temp`: a Set of keys) are marked; reroofDismantle takes them out once the roof stands
    cells: [...rec.cells, ...added.map(c => ({ ...c, seg: ren(c.seg), ...(temp?.has(c.at.join(',')) ? { temp: 1 } : {}) }))],
    // reroof-02 (b): what stands in the new roof's cells, dug first by the building's own visit (runVisit's clears: low before high)
    ...(clear.length ? { clear: [...(rec.clear ?? []), ...clear.map(c => ({ at: c.at.slice(), kind: c.kind, name: c.name, ...(c.apex === 1 ? { apex: 1 } : {}) }))] } : {}),
    segments: [...segs, ...newSegs],
    // still COMPLETE (Claude r1 note 1: an open record turns off the workshop's stations, the hall's clerk, the enchanting fitter and
    // every project `after` it): the added cells read open, so the record reads DAMAGED and the building's own visit repairs it -- the
    // order's repairs-first
    palette, style: { ...style }, restyle: { id: bpNew.id, at: now, added: added.length, ...(notch ? { notch } : {}), ...(temp?.size ? { temp: temp.size } : {}) },
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
    roofTree: !offs(env?.REROOF_ROOFTREE), ordered: !offs(env?.REROOF_ORDERED),
    // reroof-04 (11-08): a placed top slab of the new roof is a floor; a temporary cobblestone stair to the roof, torn down after
    access: !offs(env?.REROOF_ACCESS),
    // reroof-04 r5: the door-side eave stays -- a door approach (fills + cuts) that never passes under it, before any notch
    approach: !offs(env?.REROOF_ACCESS) && !offs(env?.REROOF_APPROACH),
    // reroof-04 r5: a ledge whose fall lands off the town walk is never a stand or a step (proof and visit)
    fallSafe: !offs(env?.REROOF_ACCESS) && !offs(env?.REROOF_FALLSAFE),
    // reroof-04 r6: the square step round a blocked diagonal jump (buildbot.mjs cornerCut `square`), on a re-roofed record's own visit only
    cornerSquare: !offs(env?.REROOF_ACCESS) && !offs(env?.REROOF_CORNERCUT),
    // reroof-04 r6: the jump-apex leaves listed further out, dug by the walk before a planned jump-up (REROOF_APEX)
    apex: !offs(env?.REROOF_ACCESS) && !offs(env?.REROOF_APEX) }
}
export const REROOF_FIX = Object.freeze(reroofFixes(typeof process !== 'undefined' ? process.env : {}))
/** The `_reroof_mode` licence row. Pure. */
export const reroofModeDetail = (on, fx) => `on=${on ? 1 : 0} v=2 avoid=${fx.avoid ? 1 : 0} decor=${fx.decor ? 1 : 0} clutter=${fx.clutter ? 1 : 0} fresh=${fx.fresh ? 1 : 0} doorstep=${fx.doorstep ? 1 : 0} rooftree=${fx.roofTree ? 1 : 0} ordered=${fx.ordered ? 1 : 0} access=${fx.access ? 1 : 0} approach=${fx.approach ? 1 : 0} fallsafe=${fx.fallSafe ? 1 : 0} cornercut=${fx.cornerSquare ? 1 : 0} apex=${fx.apex ? 1 : 0} fails_max=${REROOF_FAILS_MAX} fails_ttl_h=${REROOF_FAILS_TTL_MS / 3_600_000}`

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
// reroof-04 r5 (Paper sandbox4 11-08: the storehub's stair left 4 dirt_path blocks as dirt after its teardown -- the server turns a path or
// farmland under any placed block into dirt; those were the PATHS record's cells): a stair pillar never stands on such a block, nor on
// any record's cell (another project's ground is its own, never a stand's support)
export const TURNS_DIRT = /^(dirt_path|grass_path|farmland)$/
export const stairSupportOk = (b, at, recordAt = () => null) => !!b && !TURNS_DIRT.test(nmOf(b)) && !recordAt(...at)
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
  // Codex r1 BLOCKER 1: never a log that is a record's cell (this building's or another's: a log post, a log wall) anywhere in the trunk
  for (let y = lo; y <= hi; y++) if (own.has(`${x},${y},${z}`) || recordAt(x, y, z)) return null
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
export function reroofCanopyGrow (read, clear = [], reach, { own = new Set(), recordAt = () => null, r = 2, max = REROOF_GROW_MAX, rounds = REROOF_GROW_ROUNDS, roofTrees = true } = {}) {
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
        if (roofTrees && LOG_RX.test(nmOf(b)) && !have.has(k(q)) && !recordAt(...q)) {   // Codex r1 BLOCKER 4: REROOF_ROOFTREE=off lists no log
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
 * reaches now (digStand over the town walk, low before high), then (2) the proven roof cells (`cells`: proveSite's) of the FIRST
 * unfinished segment, then the next once it finishes, each free now, with no open cell below it in its column, and a step now (stepFor over the walk with the placed cells as
 * floors and the cells still to place as obstacles; the digs' walk, like runVisit clears()', blocks nothing) -- until nothing moves. ok: every dig made (the cells left are the proof's own).
 *   wantOf(c) -> stepFor's `want` for a state-bearing or reach-only cell (null: any face)
 */
export function reroofOrderedReach (read, home, clear = [], cells = [], { stood = [], walkR = 90, domain = null, wantOf = () => null, blockOf = () => null, passes = 40, floors = null, avoid = null } = {}) {
  const AIRB = Object.freeze({ name: 'air', boundingBox: 'empty' })
  const SOLIDB = Object.freeze({ name: 'cobblestone', boundingBox: 'block' })
  const k = a => a.join(',')
  const over = new Map(), R = overlay(read, over)
  const undug = new Map(clear.map(c => [k(c.at), c]))
  const open = new Map(cells.map(c => [k(c.at), c]))
  // the segments in the proof's order (runVisit works them in order: a segment that cannot finish ends the visit -- `blocked` --
  // and no later segment is placed until it does: Codex r1 BLOCKER 2)
  const segs = []
  for (const c of cells) if (!segs.includes(c.seg)) segs.push(c.seg)
  const free = at => { const b = R(...at); return !b || AIR_RX.test(nmOf(b)) || replaceableCell(b) }
  const nodesNow = (block = new Set()) => { const m = new Map(); for (const q of walkFrom(R, home, block, walkR, { stood, floors, avoid })) { const [x, y, z] = q.split(',').map(Number); const c = `${x},${z}`; if (!m.has(c)) m.set(c, []); m.get(c).push(y) } return m }
  let placed = 0, pass = 0
  for (; pass < passes && (undug.size || open.size); pass++) {
    let moved = false
    // (1) the clears, low before high (the walk re-planned only when a dig finds no stand after one landed since the last walk)
    let nodes = nodesNow(), fresh = true
    for (const c of [...undug.values()].sort((a, b) => a.at[1] - b.at[1])) {
      if (!digStand(R, c.at, nodes)) {
        if (fresh) continue
        nodes = nodesNow(); fresh = true
        if (!digStand(R, c.at, nodes)) continue
      }
      over.set(k(c.at), AIRB); undug.delete(k(c.at)); moved = true; fresh = false
    }
    // (2) the segments in order: the first unfinished one is swept (the walk re-planned between sweeps) while any of its cells can be
    // placed; the next segment only once it is finished. A placed cell is its OWN block (Codex r1 BLOCKER 3: a slab or a stair is no
    // floor to walkFrom, as on the server; `blockOf(c)` -> { name, boundingBox }, else a full block)
    for (const sg of segs) {
      const mine = cells.filter(c => c.seg === sg)
      for (let progress = true; progress;) {
        progress = false
        nodes = nodesNow(new Set(open.keys()))
        for (const c of mine) {
          const key = k(c.at)
          if (!open.has(key) || !free(c.at)) continue
          if (mine.some(o => o !== c && open.has(k(o.at)) && o.at[0] === c.at[0] && o.at[2] === c.at[2] && o.at[1] < c.at[1])) continue
          if (!stepFor(R, home, c.at, nodes, domain, wantOf(c))) continue
          over.set(key, blockOf(c) ?? SOLIDB); open.delete(key); placed++; progress = true; moved = true
        }
      }
      if (mine.some(c => open.has(k(c.at)))) break
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

/** reroof-04 r5: natural ground an APPROACH may cut (never a record's cell: the caller's recordAt; never a placed material). */
export const APPROACH_CUT = /^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|stone|andesite|diorite|granite|gravel|sand|snow|snow_block|moss_block|short_grass|tall_grass|fern|large_fern)$/
export const APPROACH_MAX = 8       // fills + cuts an approach may take
export const APPROACH_R = 8         // how far (Chebyshev) from the doorway it may reach
/** The doorway's FRONT cells (the feet cells outside its lowest doorway cells, local v - 1) -> [[x, y, z]]. Pure. */
export function reroofDoorFront (rec, bp) {
  if (!Array.isArray(bp?.doorway) || !bp.doorway.length || !Array.isArray(rec?.anchor) || !Number.isFinite(rec?.s) || !rec?.orient) return []
  const y0 = Math.min(...bp.doorway.map(c => c[2]))
  return bp.doorway.filter(c => c[2] === y0).map(([u, v]) => { const { dx, dz } = rot(rec.orient, u, v - 1); return [rec.anchor[0] + dx, rec.s + y0, rec.anchor[1] + dz] })
}
/**
 * reroof-04 r5 (OWNER via the control session 11-08: the door-side overhang is the default; "fall back to leaving it out only if that's
 * proven impossible"): A DOOR APPROACH THAT NEVER PASSES UNDER THE NEW EAVE -> { fills: [[x,y,z]], cuts: [{ at, name }] } | null. Pure.
 * LIVE 11-08 (replayed): the hall's and the enchanting workshop's doors are reached ONLY along the foundation course in front of them
 * (feet one above the pad); the new eave hangs at head height over that course, so the full roof read `interior_unreachable 0/91`,
 * `0/67`. The straight way out from the doorway meets a trench (hall z 20) or a pit and a bank (workshop z -63). The cheapest earthwork
 * (Dijkstra, each fill or cut 1) that walks from a door front cell OUTWARD (never into the pad box) to a cell the town walk reaches
 * with the new roof in place (`walked`), by walkFrom's own steps: a floor that is a full cube or a FILL (cobblestone on a solid block,
 * never on a dirt path or farmland, never a record's cell), feet and head open or CUT (natural ground: APPROACH_CUT, never a record's
 * cell), never a `block` cell (the new roof's), the step's head room by walkFrom's rule. Bounded by APPROACH_MAX and APPROACH_R. The
 * proof decides (proveSite's interior walk over the fills and cuts).
 */
export function reroofApproach (read, { from = [], walked = new Set(), block = new Set(), box = null, recordAt = () => null, max = APPROACH_MAX, r = APPROACH_R } = {}) {
  const K = (x, y, z) => `${x},${y},${z}`
  const inPad = (x, z) => Array.isArray(box) && x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3]
  const blk = (x, y, z) => block.has(K(x, y, z))
  const openAt = (x, y, z) => { const b = read(x, y, z); return !!b && isPassable(b) && !blk(x, y, z) }
  const cutOk = (x, y, z) => { const b = read(x, y, z); return !!b && APPROACH_CUT.test(nmOf(b)) && !recordAt(x, y, z) && !blk(x, y, z) }
  const free = b => !!b && (AIR_RX.test(nmOf(b)) || replaceableCell(b)) && !isLiquid(b)
  // a cell made OPEN: [] already, [cut] by one cut, null never
  const opening = (x, y, z) => (openAt(x, y, z) ? [] : cutOk(x, y, z) ? [{ at: [x, y, z], name: nmOf(read(x, y, z)) }] : null)
  // the floor under feet (x, y, z): [] a full cube already, [fill] by one fill, null never
  const flooring = (x, y, z) => {
    const f = read(x, y - 1, z)
    if (f && fullCube(f) && !blk(x, y - 1, z)) return { fills: [] }
    const g = read(x, y - 2, z)
    if (free(f) && !recordAt(x, y - 1, z) && !blk(x, y - 1, z) && g && fullCube(g) && !TURNS_DIRT.test(nmOf(g))) return { fills: [[x, y - 1, z]] }
    return null
  }
  const starts = from.filter(a => Array.isArray(a) && a.length === 3)
  if (!starts.length) return null
  const best = new Map(), q = []
  for (const s of starts) { best.set(K(...s), 0); q.push({ at: s, cost: 0, fills: [], cuts: [] }) }
  const o0 = starts[0]
  while (q.length) {
    q.sort((a, b) => a.cost - b.cost)
    const cur = q.shift()
    const [x, y, z] = cur.at
    if (cur.cost > (best.get(K(x, y, z)) ?? Infinity)) continue
    if (walked.has(K(x, y, z)) && cur.cost > 0) return { fills: cur.fills, cuts: cur.cuts, cost: cur.cost }
    if (walked.has(K(x, y, z)) && starts.length && cur.cost === 0 && !starts.some(s => K(...s) === K(x, y, z))) return { fills: [], cuts: [], cost: 0 }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz
      if (inPad(nx, nz) || Math.max(Math.abs(nx - o0[0]), Math.abs(nz - o0[2])) > r) continue
      for (const dy of [0, 1, -1]) {
        const ny = y + dy
        const fl = flooring(nx, ny, nz); if (!fl) continue
        const fe = opening(nx, ny, nz); if (!fe) continue
        const hd = opening(nx, ny + 1, nz); if (!hd) continue
        // walkFrom's head room: up -> two above the source feet; down -> one above the source feet at the target column
        const room = dy === 1 ? opening(x, y + 2, z) : dy === -1 ? opening(nx, y + 1, nz) : []
        if (!room) continue
        const cuts = [...cur.cuts, ...fe, ...hd, ...room].filter((c, i, a) => a.findIndex(d => K(...d.at) === K(...c.at)) === i)
        const fills = [...cur.fills, ...fl.fills].filter((c, i, a) => a.findIndex(d => K(...d) === K(...c)) === i)
        // a cut that is another step's floor, or a fill in a cut cell, is no plan
        if (cuts.some(c => fills.some(f => K(...f) === K(...c.at)))) continue
        const cost = cuts.length + fills.length
        if (cost > max) continue
        const k = K(nx, ny, nz)
        if (cost >= (best.get(k) ?? Infinity)) continue
        best.set(k, cost)
        q.push({ at: [nx, ny, nz], cost, fills, cuts })
      }
    }
  }
  return null
}
/**
 * (b) DOES EVERY LISTED DIG HAVE A STAND? -> { ok, unreached: [[x, y, z]] }. Pure. The town walk from home (and `stood`) over the world
 * with the digs before it applied (low before high, as runVisit digs them), each dig's stand buildrun.mjs digStand's (DIG_REACH, the
 * sight line). A dig no stand reaches would never be made, and the roof cell it holds would never be placed.
 */
export function reroofClearsReached (read, home, clear = [], { stood = [], walkR = 90, avoid = null } = {}) {
  const AIRB = Object.freeze({ name: 'air', boundingBox: 'empty' })
  const over = new Map(), unreached = []
  const cols = () => { const m = new Map(); for (const k of walkFrom(overlay(read, over), home, new Set(), walkR, { stood, avoid })) { const [x, y, z] = k.split(',').map(Number); const c = `${x},${z}`; if (!m.has(c)) m.set(c, []); m.get(c).push(y) } return m }
  let nodes = null
  for (const c of clear) {
    nodes ??= cols()
    if (!digStand(overlay(read, over), c.at, nodes)) { unreached.push(c.at.slice()); continue }
    over.set(c.at.join(','), AIRB); nodes = null
  }
  return { ok: !unreached.length, unreached }
}

// ---- REROOF-04 (11-08, owner-approved via the control session: "the builder stands on the roof's own placed sections or on a temporary
// stand that gets torn down afterwards; no bot dirt is left behind") -------------------------------------------------------------------
// LIVE showcase 11-08: the hall's retrofit failed `no_step roof-edge 5 left` and the enchanting workshop's `no_step roof-inner 27 left`
// on every try: a slab roof's courses climb in half steps over the old flat roof, and no eye on the ground (4-5 below the roof) reaches
// the inner courses; a placed slab was no floor to the walk (buildsite.mjs fullCube). Two remedies, both on the record:
//   FLOORS  a placed TOP slab of this record's new roof is a floor (buildsite.mjs walkFrom `floors`, slabTopFloor) in the proof AND the
//           visit (runVisit `p.floors`): its top face is a full block's; never a bottom slab, never another record's cell
//   TEMP    when the proof still fails `no_step`, a TEMPORARY STAIR of cobblestone pillars (the bag's scaffold stone) is tried: straight out
//           from an eave of the new roof, one step down a column, until the town walk meets it; the stair's cells are the proof's first
//           segment (built first, from the ground), marked `temp`; once every other new cell reads built, reroofDismantle moves them
//           from `cells` to `clear` (kind temp) and a visit digs them -- the record never keeps them, no bot block is left behind
// REROOF_ACCESS=off is the rollback (both).
export const REROOF_TEMP_COLS = 6       // stair columns at most (one step each)
export const REROOF_TEMP_MAX = 18       // cobblestone a stair may take (its pillars), the bag's scaffold
export const REROOF_TEMP_TRIES = 10     // stairs a proof tries (nearest the failing cell first)
export const REROOF_TEMP_PAIRS = 5      // the first few stairs are also tried in pairs (a roof whose two slopes each need one)

/** The record's own cells a placed slab would make a floor -> Set of keys (role cells whose state is a top or double slab). Pure. */
export function reroofFloors (cells = []) {
  return new Set((cells ?? []).filter(c => Array.isArray(c?.at) && ['top', 'double', ...(process.env.REROOF_BOTTOM_FLOOR === '0' ? [] : ['bottom'])].includes(String(c.ws?.type ?? ''))).map(c => c.at.join(',')))
}

/**
 * THE TEMPORARY STAIRS a proof may try -> [{ cells: [[x, y, z]] bottom up, cost, eave: [x, y, z] }] cheapest, then nearest `near`. Pure.
 *   read     the world with the listed clears applied
 *   eaves    the new roof's lowest TOP slab cells (its eave course; the stair arrives beside one, at its top face's height)
 *   box      the building's pad box [x0, z0, x1, z1] (an eave outside it names its side)
 *   walked   'x,y,z' -> the town walk has that feet cell now (the stair's foot must meet it, dy within 1)
 *   recordAt (x, y, z) -> a record holds that cell (never built into); `taken` keys never used (the new roof's own cells)
 * One stair: straight out from a landing on (or one inside) an edge of the pad box (never a corner) along that side's normal, column i's step top at eave.y - (i - 1) (feet one above), each column
 * a PILLAR of free cells from its ground up to its step, its feet and head cells free; it ends at the first column whose next column
 * holds a walked feet cell within one of its feet. Bounded: REROOF_TEMP_COLS columns, REROOF_TEMP_MAX blocks.
 */
export function reroofAccess (read, { eaves = [], box, walked = () => false, recordAt = () => null, taken = new Set(), near = null, cols = REROOF_TEMP_COLS, max = REROOF_TEMP_MAX } = {}) {
  if (!Array.isArray(box) || box.length < 4) return []
  const free = at => { const b = read(...at); return !!b && (AIR_RX.test(nmOf(b)) || replaceableCell(b)) && !/^(water|lava)$/.test(nmOf(b)) }
  const solid = at => { const b = read(...at); return !!b && b.boundingBox === 'block' && !/^(water|lava)$/.test(nmOf(b)) }
  const clean = at => !recordAt(...at) && !taken.has(at.join(','))
  const out = []
  for (const e of eaves) {
    const [ex, ey, ez] = e
    // the landing's side: the one edge of the pad box it lies on, beyond, or one inside (the old flat roof's own edge row) -- two edges
    // at once (a corner) name no single side
    const dW = ex - box[0], dE = box[2] - ex, dN = ez - box[1], dS = box[3] - ez
    const near1 = [[dW, [-1, 0]], [dE, [1, 0]], [dN, [0, -1]], [dS, [0, 1]]].filter(([d]) => d <= 1)
    if (near1.length !== 1) continue
    const n = near1[0][1]
    const cells = []
    let ok = false
    for (let i = 1; i <= cols; i++) {
      const x = ex + n[0] * i, z = ez + n[1] * i, top = ey - (i - 1), feet = top + 1
      if (!free([x, feet, z]) || !free([x, feet + 1, z]) || !clean([x, feet, z]) || !clean([x, feet + 1, z])) break
      // the pillar: down from the step to the first solid block (the ground it stands on)
      const pil = []
      let y = top, grounded = false
      for (; y > top - 8; y--) { if (solid([x, y, z])) { grounded = stairSupportOk(read(x, y, z), [x, y, z], recordAt); break } if (!free([x, y, z]) || !clean([x, y, z])) break; pil.push([x, y, z]) }
      if (!grounded) break
      for (const c of pil.reverse()) cells.push(c)
      // the foot: the next column out holds a walked feet cell within one of this step's feet (or this step is on the ground already)
      const nx = x + n[0], nz = z + n[1]
      // (a step whose top is already the ground: its own feet cell walked)
      if (walked([x, feet, z]) || [feet - 1, feet, feet + 1].some(f => walked([nx, f, nz]))) { ok = true; break }
      if (cells.length > max) break
    }
    if (!ok || !cells.length || cells.length > max) continue
    const d = near ? Math.hypot(ex - near[0], ez - near[2]) : 0
    out.push({ cells, cost: cells.length, eave: e.slice(), d })
  }
  const seen = new Set()
  return out.filter(s => { const k = s.cells.map(c => c.join(',')).join(';'); if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => a.d - b.d || a.cost - b.cost).map(({ d, ...s }) => s)
}

/**
 * (NOTCH) THE EAVE CELLS LEFT OUT -> Set of indexes into `placed`. Pure. The new roof's LOWEST course (its eave), cells of which stand
 * one or two above a feet cell the town walks now (`walked`: walkFrom's Set of 'x,y,z'): a slab at the head leaves no walk, one above
 * it no step down into that cell.
 */
export function reroofEaveNotch (placed = [], walked = new Set(), { box = null, side = null } = {}) {
  const ys = placed.map(c => c.at[1])
  if (!ys.length) return new Set()
  const low = Math.min(...ys)
  // `side` [nx, nz] with `box`: only the eave on that edge of the pad box (the doorway's side)
  const onSide = at => !side || !Array.isArray(box) || (side[0] < 0 ? at[0] <= box[0] : side[0] > 0 ? at[0] >= box[2] : side[1] < 0 ? at[2] <= box[1] : at[2] >= box[3])
  const out = new Set()
  // a walked feet cell right under it (its head there), or two under it (a step down into it passes there: walkFrom's head-room rule)
  placed.forEach((c, i) => { if (c.at[1] === low && onSide(c.at) && [1, 2].some(d => walked.has(`${c.at[0]},${c.at[1] - d},${c.at[2]}`))) out.add(i) })
  return out
}
/** THE SIDE THE DOORWAY FACES -> [nx, nz] (world) | null. Pure. A blueprint's doorway opens toward local v < 0 (buildsite facesHome). */
export function reroofDoorSide (rec) {
  if (!rec?.orient) return null
  const a = rot(rec.orient, 0, 0), b = rot(rec.orient, 0, -1)
  const n = [Math.sign(b.dx - a.dx), Math.sign(b.dz - a.dz)]
  return n[0] || n[1] ? n : null
}
/** The event loop's turn between two expensive proof steps (a bot answers its keep-alives: reroofProve is async for that alone). */
const tick = () => new Promise(r => setImmediate(r))
/** (LEAVES) A reader whose NATURAL leaves are an obstacle but no floor (a fence's box: blocks the walk, the sight line, the head) -> reader.
 *  Unread properties count as natural (the safe side for a floor). Pure. */
export function reroofNoLeafFloor (read) {
  const OB = Object.freeze({ name: 'oak_fence', boundingBox: 'block', props: null })
  return (x, y, z) => { const b = read(x, y, z); if (!b || !LEAVES_RX.test(nmOf(b))) return b; const p = b.props?.persistent; return p === true || p === 'true' ? b : OB }
}
export const FALL_DROP = 12        // how far a fall is followed down
export const FALL_PAD = 1          // the building's box + this: where its ledges, wall tops and roof are
/**
 * reroof-04 r5: THE LEDGES WHOSE FALL HAS NO WALK BACK -> Set of feet keys. Pure. `walked` the town walk (walkFrom's Set). A walked
 * feet cell over the building (its pad box + FALL_PAD) with a side where no walk step goes but the body could go (feet and head open):
 * a body that slips there falls to the first full cube below (within FALL_DROP); when that landing's feet cell is not walked from town
 * (or there is none, or it is a liquid), the ledge is AVOIDED -- never a stand, never a step, in the proof and in the visit (walkFrom
 * `avoid`; every walk's step fence). The building's own ledges stay usable (the proofs need them as stands); their falls are made
 * recoverable by reroofExitLeaves.
 */
export function reroofFallRisk (read, walked = new Set(), { box = null, pad = FALL_PAD, drop = FALL_DROP, floors = null, recover = false, keep = null } = {}) {
  const out = new Set()
  if (!Array.isArray(box) || box.length < 4) return out
  const K = (x, y, z) => `${x},${y},${z}`
  const near = (x, z) => x >= box[0] - pad && x <= box[2] + pad && z >= box[1] - pad && z <= box[3] + pad
  for (const key of walked) {
    const [x, y, z] = key.split(',').map(Number)
    if (!near(x, z)) continue
    // r6e (`keep`): the record's own temporary stair -- taken by the proof only when reroofStairSafe found every step's fall recoverable
    if (keep?.has(key)) continue
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz
      if ([0, 1, -1].some(d => walked.has(K(nx, y + d, nz)))) continue
      const a = read(nx, y, nz), h = read(nx, y + 1, nz)
      if (!a || !h || !isPassable(a) || !isPassable(h)) continue           // a wall: no fall that way
      let land = null
      // r6 (`floors`): a slab of the record's new roof is a landing too (the walk stands on it: walkFrom `floors`)
      for (let yy = y - 1; yy >= y - drop; yy--) { const b = read(nx, yy, nz); if (!b) break; if (fullCube(b) || isLiquid(b) || (floors?.has(K(nx, yy, nz)) && slabTopFloor(b))) { land = isLiquid(b) ? null : K(nx, yy + 1, nz); break } }
      // r6: a landing off the walk that a body can walk (and drop) back from to the walk is no trap (reroofRecoverable)
      if (!land || (!walked.has(land) && !(recover && reroofRecoverable(read, land, walked, { floors })))) { out.add(key); break }
    }
  }
  return out
}
/**
 * reroof-04 r5 (Paper sandbox4 11-08, twice: the enchanting workshop's builder slid off its 1-wide east course ledge 27,70,z onto the
 * terrace below and never got back: the spruces' NATURAL LEAVES hang over every step up there -- at the walk's head room over the step
 * (one above the lower cell's head) and at the jump's apex over the upper cell (one above ITS head: a jump from feet y peaks at y + 3.05,
 * so a leaf two above the upper floor stops the body -- the pathfinder plans the step and the bot jumps in place, 25 s timeouts; probed
 * on Paper 32,68,-71 -> 31,69,-71 with a leaf at 31,71,-71): THE WAYS BACK UP -> [{ at, name, kind: 'leaves' }] to list as clears.
 * Pure. Every pair of standing cells round the building (box + pad: a full floor, feet and head open) one above the other side by side:
 * natural leaves (persistent false; unread: never) at the lower cell's y + 2 and at the upper cell's y + 2, never a record's cell.
 */
export function reroofExitLeaves (read, walked = new Set(), { box = null, pad = FALL_PAD + 2, recordAt = () => null } = {}) {
  const out = new Map()
  if (!Array.isArray(box) || box.length < 4) return []
  const near = (x, z) => x >= box[0] - pad && x <= box[2] + pad && z >= box[1] - pad && z <= box[3] + pad
  const stands = (x, y, z) => { const f = read(x, y - 1, z), a = read(x, y, z), h = read(x, y + 1, z); return !!f && fullCube(f) && !!a && isPassable(a) && !!h && isPassable(h) }
  const take = at => { const b = read(...at); if (b && LEAVES_RX.test(nmOf(b)) && naturalLeafBlock(b) && !recordAt(...at)) out.set(at.join(','), { at, name: nmOf(b), kind: 'leaves' }) }
  for (const key of walked) {
    const [x, y, z] = key.split(',').map(Number)
    if (!near(x, z)) continue
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz
      // the upper cell is this walked one; the lower a standing cell beside it one below (a slip's landing, or the walk's own step)
      if (!stands(nx, y - 1, nz)) continue
      take([nx, y + 1, nz])     // the walk's head room over the step (one above the lower cell's head)
      take([x, y + 2, z])       // the jump's apex over the upper cell
    }
  }
  return [...out.values()]
}
export const APEX_PAD = FALL_PAD + 5   // r6: how far out the jump-apex leaves are listed (the live workshop pit is box + 4..5)
/**
 * reroof-04 r6: THE JUMP-APEX LEAVES further out -> [{ at, name, kind: 'leaves', apex: 1 }]. Pure. reroofExitLeaves out to box + APEX_PAD,
 * minus the cells `inner` already lists, and only the apex kind (the natural leaf at the UPPER cell's y + 2: a jump from the lower cell
 * peaks there). Tagged `apex: 1`: runVisit's clears pass skips them; the walk digs one before a planned jump-up needs it.
 */
export function reroofApexLeaves (read, walked = new Set(), { box = null, recordAt = () => null, inner = [], pad = APEX_PAD } = {}) {
  if (!Array.isArray(box) || box.length < 4) return []
  const have = new Set((inner ?? []).map(c => c.at.join(',')))
  const stands = (x, y, z) => { const f = read(x, y - 1, z), a = read(x, y, z), h = read(x, y + 1, z); return !!f && fullCube(f) && !!a && isPassable(a) && !!h && isPassable(h) }
  const near = (x, z) => x >= box[0] - pad && x <= box[2] + pad && z >= box[1] - pad && z <= box[3] + pad
  const out = new Map()
  for (const key of walked) {
    const [x, y, z] = key.split(',').map(Number)
    if (!near(x, z)) continue
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!stands(x + dx, y - 1, z + dz)) continue
      const at = [x, y + 2, z], k = at.join(',')
      if (have.has(k) || out.has(k)) continue
      const b = read(...at)
      if (b && naturalLeafBlock(b) && !recordAt(...at)) out.set(k, { at, name: nmOf(b), kind: 'leaves', apex: 1 })
    }
  }
  return [...out.values()]
}
/** r6: a proof's clear list with the apex leaves appended (never a cell it already lists). Pure. */
export function withApex (clear = [], apex = []) {
  const have = new Set(clear.map(c => c.at.join(',')))
  return [...clear, ...(apex ?? []).filter(c => !have.has(c.at.join(',')))]
}
/** r6: the record's listed jump-apex leaves -> Map key -> the listed block name (buildbot.mjs apexDig asks it). Pure. */
export const reroofApexKeys = rec => new Map((rec?.clear ?? []).filter(c => c?.apex === 1 && Array.isArray(c.at)).map(c => [c.at.join(','), c.name]))
/** (SEEDS) The stood cells outside the building's pad box (x/z) -> [[x, y, z]]. Pure. */
export function reroofSeeds (stood = [], box) {
  if (!Array.isArray(box) || box.length < 4) return stood
  return (stood ?? []).filter(c => Array.isArray(c) && !(c[0] >= box[0] && c[0] <= box[2] && c[2] >= box[1] && c[2] <= box[3]))
}
export const RECOVER_R = 16, RECOVER_DROP = 3, RECOVER_MAX = 4000
/**
 * reroof-04 r6: THE FALL-RECOVERY PATH -> bool. Pure. From a fall's landing (feet key), can a body get back to the town walk by walk
 * steps (dy -1..+1, head room) and short drops (down at most RECOVER_DROP onto a standing cell), within RECOVER_R (x/z) and RECOVER_MAX
 * cells? Natural leaves are obstacles (the caller's reader: reroofNoLeafFloor); the record's roof slabs floors (`floors`).
 */
export function reroofRecoverable (read, landing, walked = new Set(), { floors = null, r = RECOVER_R, dropMax = RECOVER_DROP, max = RECOVER_MAX } = {}) {
  const [lx, ly, lz] = String(landing).split(',').map(Number)
  if (![lx, ly, lz].every(Number.isFinite)) return false
  const K = (x, y, z) => `${x},${y},${z}`
  const floorAt = (x, y, z) => { const f = read(x, y - 1, z); return !!f && (fullCube(f) || (!!floors?.has(K(x, y - 1, z)) && slabTopFloor(f))) }
  const open = (x, y, z) => { const b = read(x, y, z); return !!b && isPassable(b) && !isLiquid(b) }
  const stand = (x, y, z) => floorAt(x, y, z) && open(x, y, z) && open(x, y + 1, z)
  const seen = new Set([K(lx, ly, lz)]), q = [[lx, ly, lz]]
  while (q.length && seen.size < max) {
    const [x, y, z] = q.shift()
    if (walked.has(K(x, y, z))) return true
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz
      if (Math.abs(nx - lx) > r || Math.abs(nz - lz) > r) continue
      const cand = []
      if (open(x, y + 2, z)) cand.push(y + 1)                            // a step up needs head room over the jump
      cand.push(y)
      for (let d = 1; d <= dropMax; d++) cand.push(y - d)                 // a step down, or a drop
      for (const ny of cand) {
        if (ny < y && ![...Array(y - ny + 1).keys()].every(i => open(nx, ny + i + 1, nz))) continue   // the column the body drops through
        if (!stand(nx, ny, nz)) continue
        const k = K(nx, ny, nz)
        if (!seen.has(k)) { seen.add(k); q.push([nx, ny, nz]) }
        break
      }
    }
  }
  return false
}
/** r6e: the feet cells on the record's temporary stair (its temp cells) -> Set of keys. Pure. */
export const reroofStairFeet = rec => stairFeetOf(reroofTempCells(rec).map(c => c.at.join(',')))
/** reroof-04 r6: the feet cells on a temporary stair (one above each stair cell that has open air over it) -> Set of keys. Pure. */
export const stairFeetOf = keys => { const ks = new Set(keys); return new Set([...ks].map(k => k.split(',').map(Number)).filter(([x, y, z]) => !ks.has(`${x},${y + 1},${z}`)).map(([x, y, z]) => `${x},${y + 1},${z}`)) }
/**
 * reroof-04 r6 (Codex r6 BLOCKER; Paper sandbox4 storehub 11-08): IS A TEMPORARY STAIR SAFE TO STAND ON? -> { ok, risky: [key] }. Pure.
 * The world with the stair and the proven roof placed (`cells`: the proof's; a cell with a slab state reads as that slab, every other one
 * as a full block); the walk over it with the roof's slabs as floors; a stair step whose side fall lands off that walk (reroofFallRisk,
 * the roof's slabs landings) is RISKY -- the visit's fall guard would avoid it, so a roof reached only over it has no stand (the storehub's
 * ridge 13,76,-54: the stair's top 21,74,-60 drops east into the 4-cell strip 22..25,69,-60 with no way back).
 */
export function reroofStairSafe (read, home, cells = [], keys = new Set(), { stood = [], walkR = 90, box = null, clear = [] } = {}) {
  const over = new Map()
  const COB = Object.freeze({ name: 'cobblestone', boundingBox: 'block', props: null })
  // Codex r6e BLOCKER: the world AFTER the listed clears (dug before the stair is used: a leaf beside a step is gone then)
  const AIRB = Object.freeze({ name: 'air', boundingBox: 'empty', props: null })
  for (const c of clear ?? []) if (Array.isArray(c?.at)) over.set(c.at.join(','), AIRB)
  for (const c of cells ?? []) { if (!Array.isArray(c?.at)) continue; const t = c.ws?.type; over.set(c.at.join(','), t ? { name: 'spruce_slab', boundingBox: 'block', props: { type: t } } : COB) }
  for (const k of keys) over.set(k, COB)
  const R2 = reroofNoLeafFloor(overlay(read, over))
  const floors = reroofFloors(cells)
  const walk = walkFrom(R2, home, new Set(), walkR, { stood, floors })
  const feet = [...stairFeetOf(keys)]
  // ...and every step is judged, walked or not (Codex r6e: an unwalked step was never judged)
  const judged = new Set([...walk, ...feet])
  const risk = reroofFallRisk(R2, judged, { box, floors, pad: FALL_PAD + 3, recover: true })
  const risky = feet.filter(k => risk.has(k))
  return { ok: !risky.length, risky }
}
/** The record's temporary stand cells still in `cells` -> [cell]. Pure. */
export const reroofTempCells = rec => (rec?.cells ?? []).filter(c => c?.temp === 1)
/**
 * IS THE STAND'S TEARDOWN DUE? -> bool. Pure. The record holds temp cells and every OTHER cell of the new roof (`reroof-*` segments)
 * reads done (`done(cell)`): the stair is no longer needed. While any roof cell is open the stair stays (a visit that dies mid-way leaves
 * it listed: the next visit uses it).
 */
export function reroofDismantleDue (rec, done = () => false) {
  const temp = reroofTempCells(rec)
  if (!temp.length) return false
  return (rec.cells ?? []).filter(c => c?.temp !== 1 && /^reroof-/.test(String(c?.seg ?? ''))).every(c => done(c))
}
/** THE TEARDOWN GENERATION -> a record: the temp cells out of `cells`, into `clear` (kind temp, cobblestone) for the dig. Pure. */
export function reroofDismantle (rec, { now = Date.now() } = {}) {
  const temp = reroofTempCells(rec)
  if (!temp.length) return null
  const keys = new Set(temp.map(c => c.at.join(',')))
  const have = new Set((rec.clear ?? []).map(c => (c?.at ?? []).join(',')))
  return { ...rec, cells: rec.cells.filter(c => !keys.has(c.at.join(','))), clear: [...(rec.clear ?? []), ...temp.filter(c => !have.has(c.at.join(','))).map(c => ({ at: c.at.slice(), kind: 'temp', name: 'cobblestone' }))],
    restyle: { ...(rec.restyle ?? {}), tempDown: now } }
}
/** The temp clears still standing -> [clear]. Pure over `read`. */
export const reroofTempStanding = (rec, read) => (rec?.clear ?? []).filter(c => c?.kind === 'temp' && nmOf(read(...c.at)) === c.name)
/** THE TEARDOWN'S VISIT RECORD (runVisit digs its clears; no cell to place). Pure. */
export const reroofTempView = rec => ({ ...rec, cells: [], clear: (rec?.clear ?? []).filter(c => c?.kind === 'temp'), segments: [] })

/**
 * reroof-04: THE RETROFIT'S WHOLE PROOF -> Promise<{ ok, why, detail, p, clear, retire, step, temp: Set | null, notch }>. Pure over `read`
 * (async only to give the event loop its turn between the expensive steps: a stair try, the notched roof). What
 * skills.mjs buildReroof ran inline (reroof-02/03) plus the access remedies; the Paper driver and the offline replays run this same code.
 *   rec     the building's head record; bpOld its blueprint; bpAdd reroofProofBlueprint's; ctx { stood, walkR, domain, decor, recordAt, fx }
 * Order: the obstacles (a blocker fails `cell_not_free`), the doorstep, the proof (with the new roof's TOP slabs as floors when
 * fx.access); a `no_step` proof tries the temporary stairs (reroofAccess, nearest the failing cell first, REROOF_TEMP_TRIES); then the
 * listed digs' reach (the ground walk, else the build order with the canopy grown -- reroof-03), re-proven with the chosen stair.
 */
export async function reroofProve (read, home, rec, bpOld, bpAdd0, { stood: stood0 = [], walkR = 90, domain = null, decor = null, recordAt = () => null, fx = reroofFixes({}) } = {}) {
  const anchor = { x: rec.anchor[0], z: rec.anchor[1] }
  // (SEEDS) a cell a bot once STOOD on inside the building's own box -- on its flat roof, LIVE: bots that pillared up -- seeds no walk
  // here: a visit's pathfinder cannot get there from the ground (Paper sandbox4 11-08: the workshop's builder dropped off the roof and
  // every walk back timed out); the roof is reached from the ground or by the temporary stair
  const stood = fx.access && Array.isArray(rec.box) ? reroofSeeds(stood0, rec.box) : stood0
  // (NOTCH) the eave course never hangs at head height over a cell the town walks now (LIVE 11-08: the hall's and the enchanting
  // workshop's front rows are walked at one above the pad -- an eave there cut every path to the door: interior 0/95, 0/88)
  // -- only when the full roof's proof fails, and only the DOOR side's eave (the side the doorway faces: reroofDoorSide)
  const run = bpAdd => reroofProveWith(read, home, rec, bpOld, bpAdd, { stood, walkR, domain, decor, recordAt, fx })
  const full = await run(bpAdd0)
  if (typeof process !== 'undefined' && process.env?.REROOF_DEBUG) console.log('  full', full.ok ? 'OK' : `${full.why} ${full.detail}`)
  if (full.ok || !fx.access || !['interior_unreachable', 'no_step'].includes(full.why)) return { ...full, notch: 0 }
  // (APPROACH, r5: the overhang is the default) a door approach that never passes under the new roof: the cheapest fills and cuts from
  // the door front to the town walk with the whole new roof in place (reroofApproach), the full roof proven over them
  if (fx.approach && full.why === 'interior_unreachable') {
    await tick()
    const placed0 = placeBlueprint(bpAdd0, anchor, rec.s, rec.orient)
    const block = new Set(placed0.map(c => c.at.join(',')))
    const PR0 = reroofNoLeafFloor(read)
    const walked = walkFrom(PR0, home, block, walkR, { stood })
    const ap = reroofApproach(PR0, { from: reroofDoorFront(rec, bpOld), walked, block, box: rec.box, recordAt })
    if (typeof process !== 'undefined' && process.env?.REROOF_DEBUG) console.log('  approach', ap ? `fills ${JSON.stringify(ap.fills)} cuts ${JSON.stringify(ap.cuts.map(c => c.at))}` : 'none')
    if (ap && (ap.fills.length || ap.cuts.length)) {
      const withAp = await reroofProveWith(read, home, rec, bpOld, bpAdd0, { stood, walkR, domain, decor, recordAt, fx, approach: ap })
      if (typeof process !== 'undefined' && process.env?.REROOF_DEBUG) console.log('  full+approach', withAp.ok ? 'OK' : `${withAp.why} ${withAp.detail}`)
      if (withAp.ok) return { ...withAp, notch: 0, approach: { fills: ap.fills.length, cuts: ap.cuts.length } }
    }
  }
  const side = reroofDoorSide(rec)
  const notch = side ? reroofEaveNotch(placeBlueprint(bpAdd0, anchor, rec.s, rec.orient), walkFrom(read, home, new Set(), walkR, { stood }), { box: rec.box, side }) : new Set()
  if (!notch.size) return { ...full, notch: 0 }
  await tick()
  const cut = await run({ ...bpAdd0, cells: bpAdd0.cells.filter((c, i) => !notch.has(i)) })
  if (typeof process !== 'undefined' && process.env?.REROOF_DEBUG) console.log('  notch', notch.size, cut.ok ? 'OK' : `${cut.why} ${cut.detail}`)
  return cut.ok ? { ...cut, notch: notch.size } : { ...full, notch: 0 }
}
/** reroofProve's proof over one proof blueprint (the full roof, or the roof with its door-side eave notched). Pure. */
async function reroofProveWith (read, home, rec, bpOld, bpAdd, { stood = [], walkR = 90, domain = null, decor = null, recordAt = () => null, fx = reroofFixes({}), approach = null } = {}) {
  const anchor = { x: rec.anchor[0], z: rec.anchor[1] }
  const placed = placeBlueprint(bpAdd, anchor, rec.s, rec.orient)
  const addedAt = placed.map(c => c.at)
  const own = new Set(rec.cells.filter(c => Array.isArray(c?.at)).map(c => c.at.join(',')))
  const ob = (fx.decor || fx.clutter) ? reroofObstacles(read, addedAt, { decor, recordAt, fx, own }) : { clear: [], retire: [], blocker: null }
  if (ob.blocker) return { ok: false, why: 'cell_not_free', detail: `${ob.blocker.name}@${ob.blocker.at.join(',')}` }
  const step = fx.doorstep ? reroofDoorstep(read, rec, bpOld) : null
  const floors = fx.access ? reroofFloors(placed) : null
  // r5: an approach's fills are permanent (a doorstep's kind: the record's earth cells), its cuts listed clears (kind cut)
  const fillOf = extra => [...(step ? [step] : []), ...(approach?.fills ?? []), ...(extra ? [...extra].map(k => k.split(',').map(Number)) : [])]
  // never worse: the interior cells walked NOW stay walked (fx.access; else every open interior cell, as before)
  // (LEAVES, below) and (FALL, r5): the ledges whose fall lands off the town walk are never a stand or a step (reroofFallRisk)
  const PR0 = fx.access ? reroofNoLeafFloor(read) : read
  if (fx.access) await tick()
  const walk0 = fx.access && fx.fallSafe ? walkFrom(PR0, home, new Set(), walkR, { stood }) : null
  const avoid = walk0 ? reroofFallRisk(PR0, walk0, { box: rec.box }) : null
  // ...and the way back up from a one-block slip off the building's own ledges: the natural leaves over the step, listed (reroofExitLeaves)
  const exitAt = (x, y, z) => recordAt(x, y, z) || own.has(`${x},${y},${z}`) || addedAt.some(a => a[0] === x && a[1] === y && a[2] === z)
  const exits = walk0 ? reroofExitLeaves(read, walk0, { box: rec.box, recordAt: exitAt }) : []
  // r6 (fx.apex): the jump-apex leaves FURTHER out (box + 4 .. + 6: where a slip lands, LIVE Paper workshop pit 32,68,-71 -> 31,69,-71, its
  // leaf 31,71,-71 at box + 4) are LISTED but never dug by the clears pass (low before high it walked down into the pit to dig them, r5e)
  // and never asked of the proof: the walk digs one only when a jump it plans needs it (buildbot.mjs apexDig), from the lower cell
  const apex = walk0 && fx.apex ? reroofApexLeaves(read, walk0, { box: rec.box, recordAt: exitAt, inner: exits }) : []
  const now = fx.access ? walkFrom(read, home, new Set(), walkR, { stood, avoid }) : null
  // (LEAVES) the proof walks on no natural leaves (fx.access): a canopy is dug, or decays once its trunk is gone (Paper sandbox4 11-08: the
  // workshop's builder reached its roof over a spruce crown, dug the crown, dropped and never got back) -- an obstacle, never a floor
  const PR = fx.access ? reroofNoLeafFloor(read) : read
  const proveWith = (cl, extra = null) => proveSite(PR, home, bpAdd, { anchor, s: rec.s, orient: rec.orient, clear: cl, fill: fillOf(extra) }, { stood, ...(domain ? { domain } : {}), walkR, floors, avoid, gone: extra ?? null, ...(now ? { interiorNow: k => now.has(k) } : {}) })
  // the listed digs' reach over a proven roof: the ground walk, else the build order (the proof's cells: a stair first, then the
  // roof, its slabs floors), else the canopy round them grown -> { ok, clear, p, rc }
  // r5: async, the event loop's turn between its expensive steps (Paper 11-08: a proof that held the loop 38 s got the bot kicked)
  const reach = async (clear0, p0, extra) => {
    if (!clear0.length) return { ok: true, clear: clear0, p: p0 }
    await tick()
    let rc = reroofClearsReached(PR, home, clear0, { stood, walkR, avoid })
    if (rc.ok || !fx.ordered) return { ok: rc.ok, clear: clear0, p: p0, rc }
    const nameOf = role => { const n = (bpAdd.palette?.[role] ?? ['stone'])[0]; return String(n).startsWith('$') ? 'oak_planks' : n }
    const ordered = (list, cells) => reroofOrderedReach(PR, home, list, cells, { stood, walkR, domain, floors, avoid, wantOf: c => (c.ws || c.blind ? { name: nameOf(c.role), ws: c.ws ?? null, blind: !!c.blind } : null),
      blockOf: c => ({ name: nameOf(c.role), boundingBox: c.role === 'light' ? 'empty' : 'block', ...(c.ws ? { props: c.ws } : {}) }) })
    await tick()
    rc = ordered(clear0, p0.cells)
    if (rc.ok) return { ok: true, clear: clear0, p: p0, rc }
    await tick()
    const g = reroofCanopyGrow(read, clear0, list => ordered(list, p0.cells), { own, recordAt, roofTrees: fx.roofTree })
    if (g.rc.ok) {
      await tick()
      const p2 = proveWith(g.clear, extra)
      await tick()
      const o2 = p2.ok ? ordered(g.clear, p2.cells) : null
      if (o2?.ok) return { ok: true, clear: g.clear, p: p2, rc: o2 }
    }
    return { ok: false, clear: clear0, p: p0, rc }
  }
  const extra0 = [...(approach?.cuts ?? []).map(c => ({ at: c.at.slice(), name: c.name, kind: 'cut' })), ...exits.map(c => ({ at: c.at.slice(), name: c.name, kind: 'leaves' }))]
  const clear = [...ob.clear, ...extra0.filter((c, i, a) => !ob.clear.some(d => d.at.join(',') === c.at.join(',')) && a.findIndex(d => d.at.join(',') === c.at.join(',')) === i)].sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])
  await tick()
  const p = proveWith(clear, null)
  const unreached = r => `${r.rc.unreached.length}/${r.clear.length} first ${r.clear.find(c => c.at.join(',') === r.rc.unreached[0].join(','))?.name}@${r.rc.unreached[0].join(',')}`
  let fail0 = null
  if (p.ok) {
    const r = await reach(clear, p, null)
    if (r.ok) return { ok: true, why: 'ok', p: r.p, clear: withApex(r.clear, apex), retire: ob.retire, step, temp: null }
    fail0 = { ok: false, why: 'clear_unreached', detail: unreached(r) }
  } else fail0 = { ok: false, why: p.why, detail: p.detail }
  // (TEMP) a roof cell with no step, or a dig no stand reaches: a temporary stair from an eave down to the town walk, proven whole (the
  // proof's first segment), its digs reached in the build order -- one stair nearest the failing cell first, then the best pairs
  if (!fx.access || !['no_step', 'clear_unreached'].includes(fail0.why)) return fail0
  const AIRB = Object.freeze({ name: 'air', boundingBox: 'empty' })
  const R = overlay(PR, new Map(clear.map(c => [c.at.join(','), AIRB])))
  const walked = walkFrom(R, home, new Set(), walkR, { stood, avoid })
  const tops = placed.filter(c => c.ws?.type === 'top')
  const lowEave = tops.length ? Math.min(...tops.map(c => c.at[1])) : null
  // the stair's LANDINGS: the new eave's cells, and the old flat roof's own edge cells (a full block, walked onto at once: Paper MOAT
  // 11-08 -- a stair beside an eave still to place leaves a gap the gable segment, placed first, cannot be built across)
  const oldTop = Math.max(...rec.cells.filter(c => Array.isArray(c?.at)).map(c => c.at[1]))
  const solidAt = a => { const b = read(...a); return !!b && b.boundingBox === 'block' && !LEAVES_RX.test(nmOf(b)) }
  const roofEdge = rec.cells.filter(c => Array.isArray(c?.at) && c.at[1] === oldTop && Math.min(c.at[0] - rec.box[0], rec.box[2] - c.at[0], c.at[2] - rec.box[1], rec.box[3] - c.at[2]) <= 1 && solidAt(c.at)).map(c => c.at)
  const eaves = [...roofEdge, ...tops.filter(c => c.at[1] === lowEave).map(c => c.at)]
  const m = String(fail0.detail ?? '').match(/@(-?\d+),(-?\d+),(-?\d+)/)
  const taken = new Set([...addedAt.map(a => a.join(',')), ...(step ? [step.join(',')] : [])])
  const stairs = reroofAccess(R, { eaves, box: rec.box, walked: a => walked.has(a.join(',')), recordAt, taken, near: m ? m.slice(1).map(Number) : null }).slice(0, REROOF_TEMP_TRIES)
  const tries = [...stairs.map(st => [st]), ...stairs.slice(0, REROOF_TEMP_PAIRS).flatMap((a, i) => stairs.slice(i + 1, REROOF_TEMP_PAIRS).map(b => [a, b]))]
  for (const set of tries) {
    const keys = new Set(set.flatMap(st => st.cells.map(c => c.join(','))))
    if (keys.size > REROOF_TEMP_MAX * 2) continue
    await tick()
    const q = proveWith(clear, keys)
    if (typeof process !== 'undefined' && process.env?.REROOF_DEBUG) console.log('  stair', set.map(st => JSON.stringify(st.eave)).join('+'), keys.size, q.ok ? 'OK' : `${q.why} ${q.detail}`)
    if (!q.ok) continue
    // r6: a stair one of whose steps would drop a builder where it cannot walk back is not taken (the visit's fall guard avoids it)
    if (fx.fallSafe) { await tick(); const sf = reroofStairSafe(read, home, q.cells, keys, { stood, walkR, box: rec.box, clear }); if (!sf.ok) { if (typeof process !== 'undefined' && process.env?.REROOF_DEBUG) console.log('    unsafe', sf.risky.join(' ')); continue } }
    await tick()
    const r = await reach(clear, q, keys)
    if (typeof process !== 'undefined' && process.env?.REROOF_DEBUG) console.log('    reach', r.ok ? 'OK' : unreached(r))
    // Codex r6f BLOCKER: the reach may grow the clears (reroofCanopyGrow): the stair is judged again on the FINAL cells and clears
    if (r.ok && fx.fallSafe) { await tick(); if (!reroofStairSafe(read, home, r.p.cells, keys, { stood, walkR, box: rec.box, clear: r.clear }).ok) continue }
    if (r.ok) return { ok: true, why: 'ok', p: r.p, clear: withApex(r.clear, apex), retire: ob.retire, step, temp: keys }
  }
  return fail0
}
