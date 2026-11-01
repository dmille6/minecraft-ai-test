// SHOPCHEST-01: THE WORKSHOP'S MATERIALS CHESTS (OWNER 10-28, workshop uses no.2: "a building-materials chest inside the workshop;
// builders load there"; follow-up: "lets make sure the chest or chests inside are easily accessable"). PURE: the switch, the cells,
// the siting, the record, the rule a build visit uses them by. The visit that places them is build_shop's ordinary blueprint visit
// (buildrun.mjs runVisit); the draw and the bank-back that use them are skills.mjs buildShop's.
//
// WHERE: inside a COMPLETE workshop@1 (5 wide x 3 deep x 2 high, u 2..6, v 2..4; back row v 4 = torch, furnace, table, furnace,
// torch; the doorway at u 4, v 1), on the FRONT row's two corner cells (u 2 and u 6, v 2) -- the owner's 10-28 measurement: four
// chests fit only on the front row and leave a one-wide aisle, so two, never side by side (they would join), never the doorway's
// inner cell (u 4, v 2), never a station cell. Each has two stands beside it (u 3 / u 5 on the front row, and the aisle cell behind
// it), nothing above it but the interior's air (the roof is at s+3), and the proof walks to every stand from town through the
// doorway before the record is written. A workshop of another blueprint, or not complete, gets none.
//
// WHAT BUILDERS DO WITH THEM (once the record is complete): a build visit draws its bill from the materials chests FIRST (no town
// reserve applies: what is in them is the builders' own, banked there by earlier visits), then from the town as before; and the
// leftovers a visit drew and did not place are banked into them FIRST, then into town chests as before. A full or unreachable
// materials chest is skipped like any container.
//
// SHOPCHEST=off is the kill switch (no siting, no draw, no bank-back: the visit as before). On only in SHOPCHEST_POOLS (default
// 'showcase') until a fleet rollout.

import { rot, isSolid, isLiquid, replaceableCell } from './townplan.mjs'
import { FOREIGN_CLEAR, STATION_CLEAR } from './buildrun.mjs'

export const SHOPCHEST_PLOT = 'shopchest'
export const SHOPCHEST_BLUEPRINT = 'shopchest@1'
export const SHOPCHEST_BUILDERS = 1
export const SHOPCHEST_PALETTE = Object.freeze({ chest: Object.freeze(['chest']) })
/** THE SWITCH -> bool. SHOPCHEST=on|off; unset = on only in the pools SHOPCHEST_POOLS names (default 'showcase'). Pure. */
export function shopchestOn (env = process.env, pool = '') {
  const v = String(env?.SHOPCHEST ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  const pools = String(env?.SHOPCHEST_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes(String(pool))
}
/** The chests' cells and the stands the proof must reach, in workshop@1's own (u, v, y). */
export const SHOPCHEST_CELLS = Object.freeze([[2, 2], [6, 2]])
export const SHOPCHEST_STANDS = Object.freeze([[3, 2], [5, 2], [2, 3], [6, 3], [4, 2], [4, 3]])
/** THE BLUEPRINT (buildsite.mjs's shape; cells in workshop@1's frame). Pure. */
export function shopchestBlueprint () {
  return {
    id: SHOPCHEST_BLUEPRINT, kind: 'shopchest',
    palette: SHOPCHEST_PALETTE,
    segments: [{ seg: 'fit-out', layer: 4, deps: [] }],
    cells: SHOPCHEST_CELLS.map(([u, v]) => ({ u, v, y: 1, role: 'chest', seg: 'fit-out' })),
    interior: SHOPCHEST_STANDS.map(([u, v]) => [u, v, 1]),
  }
}
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const k3 = a => a.join(',')
const AIRN = n => n === 'air' || n === 'cave_air' || n === 'void_air'
const litter = n => FOREIGN_CLEAR.test(n) || STATION_CLEAR.test(n)
/**
 * THE SITE inside a workshop record -> { ok, why, detail?, bp, site: { anchor, s, orient, clear, fill: [] } }. Pure over `read`.
 * The workshop must be workshop@1 and COMPLETE. Each chest cell and the cell above it, and every stand (feet and head): air or a
 * plant as it is; litter (scaffold blocks, a crafting table an idle place left: never a workshop record cell) cleared; anything
 * else refuses.
 */
export function shopchestSite (read, shop) {
  if (shop?.blueprint !== 'workshop@1') return { ok: false, why: 'no_workshop' }
  if (!shop.structure_complete) return { ok: false, why: 'workshop_open' }
  if (!Array.isArray(shop.anchor) || !['E', 'S', 'W', 'N'].includes(shop.orient) || !Number.isFinite(shop.s)) return { ok: false, why: 'workshop_shape' }
  const W = (u, v, y) => { const { dx, dz } = rot(shop.orient, u, v); return [shop.anchor[0] + dx, shop.s + y, shop.anchor[1] + dz] }
  const own = new Set((shop.cells ?? []).map(c => k3(c.at)))
  const clear = []
  const look = (at, solidRefuses) => {
    const b = read(...at)
    if (!b) return { why: 'unknown', detail: k3(at) }
    const n = nm(b)
    if (AIRN(n) || replaceableCell(b)) return null
    if (isLiquid(b)) return { why: 'liquid', detail: `${n}@${k3(at)}` }
    if (own.has(k3(at))) return { why: 'workshop_cell', detail: `${n}@${k3(at)}` }
    if (litter(n)) { clear.push({ at, kind: 'scaffold', name: n }); return null }
    if (!isSolid(b) && !solidRefuses) return null
    return { why: 'cell_not_free', detail: `${n}@${k3(at)}` }
  }
  for (const [u, v] of SHOPCHEST_CELLS) for (const y of [1, 2]) { const r = look(W(u, v, y), true); if (r) return { ok: false, ...r } }
  for (const [u, v] of SHOPCHEST_STANDS) for (const y of [1, 2]) { const r = look(W(u, v, y), false); if (r) return { ok: false, ...r } }
  return { ok: true, why: 'ok', bp: shopchestBlueprint(), site: { anchor: { x: shop.anchor[0], z: shop.anchor[1] }, s: shop.s, orient: shop.orient, clear, fill: [] } }
}
/** THE RECORD from a site and its proof (buildsite.mjs proveSite) -> the record (siteBlueprint's shape). Pure. */
export function shopchestRecord (st, proof, { home, plan = null, now = 0 } = {}) {
  const cs = proof.cells
  const xs = cs.map(c => c.at[0]), zs = cs.map(c => c.at[2])
  return {
    v: 1, blueprint: SHOPCHEST_BLUEPRINT, plot: SHOPCHEST_PLOT, home, sector: 'workshop', sector_source: 'shop', orient: st.site.orient,
    anchor: [st.site.anchor.x, st.site.anchor.z], box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], s: st.site.s, floor: st.site.s,
    earthwork: { fill: 0, cut: 0, litter: st.site.clear.length }, fill: [], clear: st.site.clear, trees: [], felled: 0, replant: [],
    cells: cs, segments: proof.segments, interior: proof.interior, bom: { chest: cs.length }, builders_max: SHOPCHEST_BUILDERS,
    structure_complete: false, plan: plan ? { gen: plan.gen } : null, sitedAt: now,
  }
}
/** THE MATERIALS CHESTS a build visit uses -> [[x, y, z]]: a COMPLETE record's chest cells, never for the materials chests' own
 *  visit. Pure. */
export function materialsChests (rec, { on = true, plot = null } = {}) {
  if (!on || plot === SHOPCHEST_PLOT || rec?.blueprint !== SHOPCHEST_BLUEPRINT || !rec.structure_complete) return []
  return (rec.cells ?? []).filter(c => c.role === 'chest' && Array.isArray(c.at)).map(c => c.at.slice())
}
/** May the visit try a materials chest for `need`? -> bool. Pure. Its index entry (`names`: { name: [count, slots] }) when the
 *  index knows it: only if it holds a name the visit needs; unknown (never opened, or stale): yes, once. */
export function materialsWorthTry (names, need = {}) {
  if (!names || typeof names !== 'object') return true
  return Object.keys(need).some(n => (Number(names[n]?.[0]) || 0) > 0 || (/_planks$/.test(n) && Object.keys(names).some(m => /_planks$/.test(m) && (Number(names[m]?.[0]) || 0) > 0)))
}
