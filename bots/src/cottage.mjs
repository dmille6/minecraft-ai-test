// TOWNSTYLE-01: THE COTTAGE, the town's first building with a PITCHED ROOF (OWNER 2026-11-04: "can we put some design charm into the
// buildings and not have flat roofs, lets make them have angled roofs etc, to make it look more like a town not just blocks with
// doors"; design docs/reports/townstyle-design-2026-11-04.md on main, Claude + Codex). PURE: the switch, the opening rule, the siting
// plan on the wall extension's house-size plot, the style chosen at siting, the record, the visit's options.
//
// THE BUILDING (blueprints/cottage@1s.json and cottage@1f.json, written by bots/scripts/make-cottage.mjs from townstyle.mjs
// cottageBlueprint): a 7 x 7 pad, a 5 x 5 timber-framed room 3 high (a stone course, log corner posts, plank walls, glass windows with
// trapdoor sills), torches either side of the open doorway, a 45-degree gable roof of stairs with eaves all round and a slab ridge.
// Variant `s` turns its eaves to the front, `f` its gable (chosen by the seed at siting, like the shrines' and the towers' details).
// THE STYLE (townstyle.mjs styleOf) is chosen ONCE, at siting, from the town's stock -- the wall wood the town's most-stocked log, a
// contrasting roof wood when the town holds enough of one, cobblestone or stone bricks -- and written into the record's OWN palette:
// every visit, the bill, the damage read and the repairs use the record's palette, so a roof is never two woods and never re-rolled.
//
// THE PLOT: the wall extension's house-size plots (wall.mjs WALLEXT.plotSizes `house`, 11 x 11), the owner's 11-04 order "1) an
// enchanting + anvil workshop, 2) a new town/meeting hall, 3) houses": the cottage takes the FIRST house plot no other record holds,
// after the enchanting workshop stands (the town hall has no blueprint yet: owner decision named in the design, COTTAGE_AFTER).
// COTTAGE=off is the kill switch (never offered, never sited; a sited record stays guarded). On only in COTTAGE_POOLS (default
// 'showcase').

import { rot } from './townplan.mjs'
import { styleOf, stylePalette } from './townstyle.mjs'

export const COTTAGE_PLOT = 'cottage1'
/** The blueprint family: `cottage@1s` (eaves to the front) and `cottage@1f` (gable to the front). */
export const COTTAGE_VARIANTS = Object.freeze(['s', 'f'])
export const cottageBlueprintId = v => `cottage@1${v}`
export const isCottageBlueprint = id => /^cottage@1[sf]$/.test(String(id ?? ''))
export const COTTAGE_BUILDERS = 2
/** The project it waits for (the owner's order: the enchanting workshop first; the town hall, second in that order, has no design). */
export const COTTAGE_AFTER = 'enchantshop'
/** The plot kind it takes from the wall extension's record. */
export const COTTAGE_PLOT_KIND = 'house'
/** The earthwork on its plot (the plot's ground is within WALLEXT.plotSpread 4). */
export const COTTAGE_EARTH = Object.freeze({ col: 4, fill: 80, cut: 80 })
/** The stands' domain: the pad + this; the walk's radius (the plots lie ~70 from home). */
export const COTTAGE_SITE = Object.freeze({ standPad: 3, walkR: 90 })
/** What the style's choices are sized on (townstyle.mjs styleOf `need`): the roof's logs, the wall wood's logs, the stone. */
export const COTTAGE_NEED = Object.freeze({ roof: 20, wall: 16, stone: 64 })

const onOff = v => { const s = String(v ?? '').trim().toLowerCase(); return ['on', '1', 'true', 'yes'].includes(s) ? true : ['off', '0', 'false', 'no'].includes(s) ? false : null }
/** THE SWITCH -> { on }. COTTAGE=on|off; unset = on only in COTTAGE_POOLS (default 'showcase'). Pure. */
export function cottageSwitches (env = process.env, pool = '') {
  const pools = String(env?.COTTAGE_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return { on: onOff(env?.COTTAGE) ?? pools.includes(String(pool)) }
}

const ok4 = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)
/** The first house-size plot of the extension that no other record names as its plot (`taken`: plot ids) -> plot | null. Pure. */
export function cottagePlotOf (ext, taken = []) {
  const plots = (ext?.plots ?? []).filter(p => p?.kind === COTTAGE_PLOT_KIND && ok4(p.box))
  return plots.find(p => !taken.includes(p.id)) ?? null
}
/**
 * THE OPENING RULE -> { open, why, plot }. Pure. Offered (and sited) only once the wall extension is SITED with a free house-size plot
 * at least 9 x 9 (the 7 x 7 pad and its stand ring); before that it WAITS (shop.mjs activeProject skips a waiting project).
 */
export function cottageOpening (ext, taken = []) {
  if (!ext) return { open: false, why: 'no_extension', plot: null }
  const plot = cottagePlotOf(ext, taken)
  if (!plot) return { open: false, why: 'no_house_plot', plot: null }
  const w = plot.box[2] - plot.box[0] + 1, d = plot.box[3] - plot.box[1] + 1
  if (Math.min(w, d) < 9) return { open: false, why: `plot_${w}x${d}`, plot }
  return { open: true, why: 'ok', plot }
}
const inBox = (b, x, z, m = 0) => x >= b[0] - m && x <= b[2] + m && z >= b[1] - m && z <= b[3] + m
/**
 * THE SITING PLAN on the plot -> buildsite.mjs siteBlueprint's ctx extras { domain, standDomain, walkR, line, sectors, plot, earth, zones }
 * | null. Pure. The pad and its ring inside the plot; stands up to standPad beyond it; the plot's own `land:plot` zone (landplan.mjs
 * landPlotZones, id = the plot's) the ONE zone dropped -- every other zone, record and corridor still refuses (enchantshop's rule).
 */
export function cottageSitingPlan (home, plot, zones = []) {
  if (!home || !plot?.box) return null
  const b = plot.box
  const line = Math.ceil(Math.max(...[[b[0], b[1]], [b[2], b[3]], [b[0], b[3]], [b[2], b[1]]].map(([x, z]) => Math.hypot(x - home.x, z - home.z)))) + 2
  const mine = z => String(z?.why ?? '') === 'land:plot' && String(z?.id ?? '') === String(plot.id ?? '')
  return {
    domain: (x, z) => inBox(b, x, z, 0),
    standDomain: (x, z) => inBox(b, x, z, COTTAGE_SITE.standPad),
    walkR: Math.max(COTTAGE_SITE.walkR, line + 8), line, sectors: [{ sector: null, source: `plot:${plot.id ?? '?'}` }], plot: COTTAGE_PLOT, earth: COTTAGE_EARTH,
    zones: (zones ?? []).filter(z => !mine(z)),
  }
}
/**
 * THE STYLE AND ITS BLUEPRINT for a plot -> { style, id, palette } (the blueprint to load, the palette the siting proves and the record
 * keeps). Pure. `town` the indexed stock; the seed is the pool, the project and the plot (the same plot always gets the same variant).
 */
export function cottageStyle (town = {}, { pool = '', plotId = '' } = {}) {
  const style = styleOf(town, { key: `${pool}/${COTTAGE_PLOT}/${plotId}`, need: COTTAGE_NEED, variants: COTTAGE_VARIANTS })
  return { style, id: cottageBlueprintId(style.variant) }
}
/** A blueprint with the style's palette (what siteBlueprint proves and the record keeps). Pure. */
export const styledBlueprint = (bp, style) => ({ ...bp, palette: stylePalette(bp.palette, style) })
/** The record a siting result becomes -> the record plus `style`, `palette` (the resolved one: the record's own), `plotId`, `walkR`. Pure. */
export function cottageRecordOf (siteRec, styledBp, style, { plotId = null, walkR = COTTAGE_SITE.walkR } = {}) {
  return { ...siteRec, style: { ...style }, palette: styledBp.palette, plotId, walkR }
}
/** The stands' domain of a sited record (the visit's) -> (x, z) -> bool. Pure. */
export const cottageStandDomain = rec => (ok4(rec?.box) ? (x, z) => inBox(rec.box, x, z, COTTAGE_SITE.standPad) : () => false)
/** buildrun runVisit's options for the visit (the stands' domain, the record's walk radius). Pure. */
export const cottageVisitOpts = rec => (isCottageBlueprint(rec?.blueprint) ? { domain: cottageStandDomain(rec), walkR: Number.isFinite(rec.walkR) ? rec.walkR : COTTAGE_SITE.walkR } : {})
/** THE COTTAGE'S WAY IN -> [[x, z]]: the doorway's column and the approach before it, one wider each side (access-01 reads it). Pure. */
export const COTTAGE_APPROACH = 3
export function cottageEntranceCols (rec, { depth = COTTAGE_APPROACH } = {}) {
  if (!isCottageBlueprint(rec?.blueprint) || !Array.isArray(rec.anchor) || !rec.orient) return []
  const out = []
  for (let u = 2; u <= 4; u++) for (let v = -depth; v <= 1; v++) { const { dx, dz } = rot(rec.orient, u, v); out.push([rec.anchor[0] + dx, rec.anchor[1] + dz]) }
  return out
}
/** THE PALETTE A RECORD IS BUILT AND JUDGED BY: its own (a styled record), else its blueprint's. Pure. */
export const recordPalette = (rec, bp) => (rec?.palette && typeof rec.palette === 'object' && isCottageBlueprint(rec.blueprint) ? rec.palette : bp?.palette ?? {})
