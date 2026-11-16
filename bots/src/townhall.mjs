// TOWNSTYLE-02: THE TOWN HALL (OWNER 2026-11-04 order for the wall extension's plots: "1) an enchanting + anvil workshop, 2) a new
// town/meeting hall, 3) houses"; control session 11-05: "a TOWN HALL design in the same style (owner's plot X2)"; design
// docs/reports/townstyle-design-2026-11-04.md section 9). PURE: the switch, the opening rule (the extension's second hall-size plot), the
// siting plan, the style, the record, the visit's options. The building is blueprints/townhall@1.json (townstyle.mjs townhallBlueprint,
// written by bots/scripts/make-townstyle.mjs): an 11 x 17 pad, a 9 x 14 timber-framed hall with a porch, pews and a 1:2 slab roof.
// TOWNHALL=off is the kill switch (a sited record stays guarded); on only in TOWNHALL_POOLS (default 'showcase').

import { cottageSitingPlan, cottageStandDomain, styledBlueprint } from './cottage.mjs'
import { styleOf } from './townstyle.mjs'
import { rot } from './townplan.mjs'   // the batch9 fold: townhallEntranceCols

export const TOWNHALL_PLOT = 'townhall'
export const TOWNHALL_BLUEPRINT = 'townhall@1'
export const TOWNHALL_BUILDERS = 2
/** After the enchanting workshop (the owner's order); the houses do not wait for it (control session 11-05). */
export const TOWNHALL_AFTER = 'enchantshop'
/** The extension's hall-size plot the town hall takes: X2 (X1 is the enchanting workshop's: enchantshop.mjs ENCHANT_PLOT_ID). */
export const TOWNHALL_PLOT_ID = 'X2'
export const TOWNHALL_PLOT_KIND = 'hall'
export const TOWNHALL_EARTH = Object.freeze({ col: 4, fill: 160, cut: 160 })
export const TOWNHALL_SITE = Object.freeze({ standPad: 3, walkR: 90 })
/** The style's needs: the roof's logs (152 slabs, 16 ridge planks, the canopy: ~30 logs, with a margin), the walls' and posts', the stone. */
export const TOWNHALL_NEED = Object.freeze({ roof: 48, wall: 60, stone: 200 })

const onOff = v => { const s = String(v ?? '').trim().toLowerCase(); return ['on', '1', 'true', 'yes'].includes(s) ? true : ['off', '0', 'false', 'no'].includes(s) ? false : null }
/** THE SWITCH -> { on }. TOWNHALL=on|off; unset = on only in TOWNHALL_POOLS (default 'showcase'). Pure. */
export function townhallSwitches (env = process.env, pool = '') {
  const pools = String(env?.TOWNHALL_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return { on: onOff(env?.TOWNHALL) ?? pools.includes(String(pool)) }
}
const ok4 = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)
/** The extension's plot for the town hall -> X2 if it is a hall-size plot no other record holds, else null. Pure. */
export function townhallPlotOf (ext, taken = []) {
  const plots = (ext?.plots ?? []).filter(p => p?.kind === TOWNHALL_PLOT_KIND && ok4(p.box) && !taken.includes(p.id))
  return plots.find(p => p.id === TOWNHALL_PLOT_ID) ?? null
}
/** THE OPENING RULE -> { open, why, plot }. Pure. Only once the extension is sited with its X2 (at least 13 x 19 either way). */
export function townhallOpening (ext, taken = []) {
  if (!ext) return { open: false, why: 'no_extension', plot: null }
  const plot = townhallPlotOf(ext, taken)
  if (!plot) return { open: false, why: 'no_x2_plot', plot: null }
  const w = plot.box[2] - plot.box[0] + 1, d = plot.box[3] - plot.box[1] + 1
  if (Math.min(w, d) < 13 || Math.max(w, d) < 19) return { open: false, why: `plot_${w}x${d}`, plot }
  return { open: true, why: 'ok', plot }
}
/** THE SITING PLAN on the plot: the cottage's (the pad and ring in the plot, stands to +3, the plot's own land zone dropped). Pure. */
export function townhallSitingPlan (home, plot, zones = []) {
  const sp = cottageSitingPlan(home, plot, zones)
  return sp ? { ...sp, plot: TOWNHALL_PLOT, earth: TOWNHALL_EARTH, walkR: Math.max(TOWNHALL_SITE.walkR, sp.line + 8) } : null
}
/** The style for X2 -> { style }. Pure. One variant; the seed picks the stone. */
export const townhallStyle = (town = {}, { pool = '', plotId = '' } = {}) => ({ style: styleOf(town, { key: `${pool}/${TOWNHALL_PLOT}/${plotId}`, need: TOWNHALL_NEED, variants: ['a'] }) })
export { styledBlueprint }
/** The record a siting result becomes (its style and resolved palette kept: the record's own). Pure. */
/**
 * THE TOWN HALL'S WAY IN -> [[x, z]] (the showcase batch9 fold, Codex fold BLOCKER: access-01's staircases read a build's `door` /
 * `frontOpen`, and a town-hall record names neither -- a climb before the porch could become a stone stair across the entrance). The
 * doorway's columns (blueprint u 4..6, v 2), the porch before it and the approach beyond (v 1 down to -TOWNHALL_APPROACH), one column
 * wider each side (u 3..7). Pure; a record that is not a placed town hall gives none.
 */
export const TOWNHALL_APPROACH = 3
export function townhallEntranceCols (rec, { depth = TOWNHALL_APPROACH } = {}) {
  if (rec?.blueprint !== TOWNHALL_BLUEPRINT || !Array.isArray(rec.anchor) || !rec.orient) return []
  const out = []
  for (let u = 3; u <= 7; u++) for (let v = -depth; v <= 2; v++) { const { dx, dz } = rot(rec.orient, u, v); out.push([rec.anchor[0] + dx, rec.anchor[1] + dz]) }
  return out
}
export function townhallRecordOf (siteRec, styledBp, style, { plotId = null, walkR = TOWNHALL_SITE.walkR } = {}) {
  return { ...siteRec, style: { ...style }, palette: styledBp.palette, plotId, walkR }
}
/** buildrun runVisit's options for its visit. Pure. */
export const townhallVisitOpts = rec => (rec?.blueprint === TOWNHALL_BLUEPRINT ? { domain: cottageStandDomain(rec), walkR: Number.isFinite(rec.walkR) ? rec.walkR : TOWNHALL_SITE.walkR } : {})
