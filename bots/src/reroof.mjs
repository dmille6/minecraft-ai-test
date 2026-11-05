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
export function reroofNext (records = {}, { logs = null, targets = REROOF_TARGETS, damaged = () => false, failed = {} } = {}) {
  // OPEN: a styled build not complete (a cottage, the town hall), or a retrofit generation whose added roof is not all done yet (it stays
  // `structure_complete` -- the building keeps its stations, its clerk, its fit-out -- so its open roof is read as DAMAGE: Claude r1 note 1)
  const open = Object.entries(records).find(([, r]) => isStyled(r) && (!r.structure_complete || (!!r.restyle && damaged(r))))
  if (open) return { target: null, why: `styled_open:${open[0]}` }
  if (logs == null) return { target: null, why: 'stock_unknown' }
  for (const t of targets) {
    const r = records[t.plot]
    if (!r || !r.structure_complete || isStyled(r) || r.blueprint !== t.blueprint) continue
    // a building whose added roof failed its proof REROOF_FAILS_MAX times is passed over (named), never the queue's end (Claude r1 note 3)
    if ((Number(failed?.[t.plot]) || 0) >= REROOF_FAILS_MAX) continue
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
export function reroofProofBlueprint (bpOld, bpNew, style) {
  // ...and the enchanting workshop's FIT-OUT slots (its anvil, table and shelves stand there: never record cells -- Codex r4 BLOCKER 1)
  const filled = new Set([...bpOld.cells, ...(bpOld.fit ?? [])].map(c => `${c.u},${c.v},${c.y}`))
  return {
    ...bpNew,
    cells: reroofAdded(bpOld, bpNew),
    segments: (bpNew.segments ?? []).filter(s => ['gable', 'roof-edge', 'roof-inner'].includes(s.seg)),
    palette: stylePalette(bpNew.palette, style),
    interior: (bpOld.interior ?? []).filter(([u, v, y]) => !filled.has(`${u},${v},${y}`)),
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
export function reroofRecord (rec, added, bpNew, style, { now = Date.now() } = {}) {
  // the old segments stay as they are (their cells are done, the flat roof's included); the NEW roof's segments are `reroof-*`, the
  // first after the old flat roof (complete in the world), so the two never mix
  const segs = (rec.segments ?? []).map(s => ({ ...s }))
  const ren = s => `reroof-${s}`
  const flat = segs.some(s => s.seg === 'roof-inner') ? ['roof-inner'] : []
  const newSegs = (bpNew.segments ?? []).filter(s => ['gable', 'roof-edge', 'roof-inner'].includes(s.seg)).map(s => ({ ...s, seg: ren(s.seg), deps: s.seg === 'gable' ? flat : (s.deps ?? []).map(ren) }))
  const palette = { ...stylePalette(bpNew.palette, style) }
  return {
    ...rec,
    cells: [...rec.cells, ...added.map(c => ({ ...c, seg: ren(c.seg) }))],
    segments: [...segs, ...newSegs],
    // still COMPLETE (Claude r1 note 1: an open record turns off the workshop's stations, the hall's clerk, the enchanting fitter and
    // every project `after` it): the added cells read open, so the record reads DAMAGED and the building's own visit repairs it -- the
    // order's repairs-first
    palette, style: { ...style }, restyle: { id: bpNew.id, at: now, added: added.length },
  }
}
