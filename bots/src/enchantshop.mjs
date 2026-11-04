// ENCHANTSHOP-01: THE ENCHANTING + ANVIL WORKSHOP on the wall extension's hall-size plot (OWNER 2026-11-04: "plots inside the new wall
// extension are built in this order: 1) an ENCHANTING + ANVIL WORKSHOP on the hall-size plot, 2) a new town/meeting hall, 3) houses";
// "materials chain matters more than the shell"; design docs/reports/enchantshop-design-2026-11-04.md on main, Claude + Codex).
// PURE: the switch, the opening rule, the siting plan on the plot, the record, the FIT-OUT (what is placed when its inputs arrive),
// its materials plan, its gate rows (the requests board's input). Nothing here touches a bot, a window or a file.
//
// THE BUILDING (blueprints/enchantshop@1.json, docs/reports/enchantshop-2026-11-04/make_enchantshop.py): the storage hall's shape on a
// 17 x 11 pad (with its stand ring, the 19 x 13 plot exactly), 459 cells -- a cobblestone pad, a step ring, walls set back one cell (a stone-brick course, a plank
// course with glass bays), stone-brick eaves, a plank roof, a 3-wide doorway toward home, 4 floor torches, a BOOK CHEST and a
// CRAFTING TABLE. That SHELL is an ordinary blueprint record built by build_shop's visit from what the town has today.
//
// THE FIT-OUT is the record's `fit` list, NEVER cells (so a missing anvil is never damage, never holds the project order and never
// makes a builder stop no_material): the ANVIL, the ENCHANTING TABLE and 15 BOOKSHELVES round it at the vanilla 1-block gap (the 5 x 5
// ring less its front middle, the way in; the 3 x 3 between kept air: `gap`). Each slot is placed by the FITTER (one leased bot, the
// complete record's upkeep) when its item is in the bag, or its inputs are in the bag + the town above the keeps: drawn, crafted at the
// workshop's own table, placed by buildrun's visit on a one-cell record, banked back. A placed slot is stamped on the record
// (`placed`); a stamped slot that later reads open is LOST (named, never rebuilt by itself: Codex design 11-04, an anvil is 31 iron).
//
// EACH FURNISHING IS ITS OWN REQUEST (the owner's "so the requests journal can show what's missing"): `_enchantshop_gate fit=<anvil|
// table|shelves> why=wait|ok|placed short=<item:n,...>` rows name the ROOT inputs the town lacks for every slot of that furnishing
// still open (books expand to paper + leather, paper to sugar cane, iron blocks to ingots); requests.mjs turns them into one town
// request per (furnishing, item) and closes them when the furnishing stands.
//
// THE KEEPS (never spent by the fitter): iron_ingot IRON_KEEP in town (the toolkit's picks: 268 `_kit_search no_iron` in 7 days),
// diamond DIAMOND_KEEP (a deep-miner pick), the bag's own kit (bag iron, cane the park plants) -- the bag gives only fit items and their
// made intermediates (anvil, iron_block, enchanting_table, bookshelf, book, paper, obsidian, leather).
//
// ENCHANTSHOP=off is the kill switch (never offered, never sited, no fitter, no gate rows; a sited record stays guarded). On only in
// ENCHANTSHOP_POOLS (default 'showcase'). ENCHANTSHOP_FIT=off stops the fitter alone (the gate rows go on).

import { rot } from './townplan.mjs'

export const ENCHANT_PLOT = 'enchantshop'
export const ENCHANT_BLUEPRINT = 'enchantshop@1'
export const ENCHANT_BUILDERS = 2
/** The plot kind it takes from the wall extension's record (wall.mjs WALLEXT.plotSizes: 'hall' 19 x 13). */
export const ENCHANT_PLOT_KIND = 'hall'
/** The earthwork on its plot (the plot's ground is within WALLEXT.plotSpread 4; the storage hall's limits). */
export const ENCHANT_EARTH = Object.freeze({ col: 4, fill: 160, cut: 160 })
/** The stands' domain: the pad + this; the town walk's radius (the plot lies ~70 from home). */
export const ENCHANT_SITE = Object.freeze({ standPad: 3, walkR: 90 })
/** THE KEEPS: town iron_ingot the fitter never takes below; diamonds likewise. */
export const IRON_KEEP = 64
export const DIAMOND_KEEP = 3
/** How far a bot finds the workshop's anvil / table from (enchant.mjs's skills scan 32 round the bot; the workshop is ~60 from home). */
export const ENCHANT_STATION_FIND = 96
/** A workshop station this bot's walk failed to reach is not offered from afar again for this long. */
export const ENCHANT_STATION_BAN_MS = 2 * 3600_000
/** The fitter's lease, its gap between visits per bot, its back-off after a visit that placed nothing, the gate row cadence. */
export const FIT_LEASE_MS = 8 * 60_000
export const FIT_GAP_MS = 3 * 60_000
export const FIT_IDLE_MS = 20 * 60_000
export const GATE_ROW_MS = 30 * 60_000
/** A fitter visit's budget (the storage hall upkeep's) and the free bag slots it wants. */
export const FIT_VISIT_MS = 150_000
export const FIT_MIN_FREE = 4

const onOff = v => { const s = String(v ?? '').trim().toLowerCase(); return ['on', '1', 'true', 'yes'].includes(s) ? true : ['off', '0', 'false', 'no'].includes(s) ? false : null }
/** THE SWITCHES -> { on, fit }. ENCHANTSHOP=on|off; unset = on only in ENCHANTSHOP_POOLS (default 'showcase'). Pure. */
export function enchantSwitches (env = process.env, pool = '') {
  const pools = String(env?.ENCHANTSHOP_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  const on = onOff(env?.ENCHANTSHOP) ?? pools.includes(String(pool))
  return { on, fit: on && onOff(env?.ENCHANTSHOP_FIT) !== false }
}

// ---- the opening and the siting --------------------------------------------------------------------------------------------
/** The plot id the workshop takes (coordinator 11-04: X1; X2, the second hall-size plot, is the town hall's). */
export const ENCHANT_PLOT_ID = 'X1'
/** The wall extension's plot for the workshop -> { id, box: [x0, z0, x1, z1], y } | null. Pure. The hall-size plot X1 (wallext-01 r2
 *  reserves two hall-size plots: X1 19 x 13 for the workshop, X2 13 x 19 for the town hall); a record without an X1 (an older
 *  generation) gives its first hall-size plot that is 19 along x (the workshop's pad runs along x). */
export function enchantPlotOf (ext) {
  const ok = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)
  const plots = (ext?.plots ?? []).filter(p => p?.kind === ENCHANT_PLOT_KIND && ok(p.box))
  return plots.find(p => p.id === ENCHANT_PLOT_ID) ?? plots.find(p => p.box[2] - p.box[0] + 1 >= 19 && p.box[3] - p.box[1] + 1 >= 13) ?? null
}
/**
 * THE OPENING RULE -> { open, why, plot }. Pure. The workshop is offered (and sited) only once the wall extension is SITED with a
 * hall-size plot (wallext-01 writes its plots at siting): before that it WAITS (shop.mjs activeProject skips it, the copper hall's
 * pattern), so the order never offers a project that cannot site. The extension's ring need not be complete: the plot is reserved
 * from its siting on, and building inside a ring under construction is ordinary.
 */
export function enchantOpening (ext) {
  if (!ext) return { open: false, why: 'no_extension', plot: null }
  const plot = enchantPlotOf(ext)
  if (!plot) return { open: false, why: 'no_hall_plot', plot: null }
  const w = plot.box[2] - plot.box[0] + 1, d = plot.box[3] - plot.box[1] + 1
  if (Math.max(w, d) < 19 || Math.min(w, d) < 13) return { open: false, why: `plot_${w}x${d}`, plot }
  return { open: true, why: 'ok', plot }
}
const inBox = (b, x, z, m = 0) => x >= b[0] - m && x <= b[2] + m && z >= b[1] - m && z <= b[3] + m
/**
 * THE SITING PLAN on the plot -> buildsite.mjs siteBlueprint's ctx extras { domain, standDomain, walkR, line, sectors, plot, earth,
 * zones } | null. Pure. The screen's domain is the plot itself: the 17 x 11 pad and its 1-cell stand ring ARE the 19 x 13 plot (offline
 * 11-04: a ring one beyond the plot met the hall's reservation and an expedition marker); the plot's own `land:plot` zone (landplan.mjs landPlotZones, id = the plot's) is the ONE zone dropped
 * -- the workshop is what the plot was reserved for; every other zone, record and corridor still refuses.
 */
export function enchantSitingPlan (home, plot, zones = []) {
  if (!home || !plot?.box) return null
  const b = plot.box
  const line = Math.ceil(Math.max(...[[b[0], b[1]], [b[2], b[3]], [b[0], b[3]], [b[2], b[1]]].map(([x, z]) => Math.hypot(x - home.x, z - home.z)))) + 2
  const mine = z => String(z?.why ?? '') === 'land:plot' && String(z?.id ?? '') === String(plot.id ?? '')
  return {
    domain: (x, z) => inBox(b, x, z, 0),
    standDomain: (x, z) => inBox(b, x, z, ENCHANT_SITE.standPad),
    walkR: Math.max(ENCHANT_SITE.walkR, line + 8), line, sectors: [{ sector: null, source: `plot:${plot.id ?? '?'}` }], plot: ENCHANT_PLOT, earth: ENCHANT_EARTH,
    zones: (zones ?? []).filter(z => !mine(z)),
  }
}
/** The stands' domain of a sited record (the visit's) -> (x, z) -> bool. Pure. */
export const enchantStandDomain = rec => (Array.isArray(rec?.box) && rec.box.length === 4 ? (x, z) => inBox(rec.box, x, z, ENCHANT_SITE.standPad) : () => false)
/** buildrun runVisit's options for the shell visit (the stands' domain, the record's walk radius). Pure. */
export const enchantVisitOpts = rec => (rec?.blueprint === ENCHANT_BLUEPRINT ? { domain: enchantStandDomain(rec), walkR: Number.isFinite(rec.walkR) ? rec.walkR : ENCHANT_SITE.walkR } : {})

/** A blueprint cell (u, v, y) of a sited record -> world [x, y, z]. Pure. */
const cellAt = (rec, u, v, y) => { const { dx, dz } = rot(rec.orient, u, v); return [rec.anchor[0] + dx, rec.s + y, rec.anchor[1] + dz] }
/**
 * THE RECORD a siting result becomes -> the record, plus `fit` [{ slot, item, at, stand }], `gap` [[x, y, z]], `entry`, `signs`
 * (sortstore.mjs signSpots' shape: { chest, at, wall, face, lines, stand }), `plotId`, `walkR`. Pure.
 */
export function enchantRecordOf (siteRec, bp, { plotId = null, walkR = ENCHANT_SITE.walkR } = {}) {
  const r = { ...siteRec }
  const at = (u, v, y) => cellAt(r, u, v, y)
  r.fit = (bp.fit ?? []).map(f => ({ slot: f.slot, item: f.item, at: at(f.u, f.v, f.y), stand: Array.isArray(f.stand) ? at(...f.stand) : null }))
  r.gap = (bp.gap ?? []).map(([u, v, y]) => at(u, v, y))
  r.entry = Array.isArray(bp.entry) ? at(...bp.entry) : null
  r.signs = (bp.signs ?? []).map(s => {
    const a = at(...s.at), w = at(...s.wall)
    return { chest: `enchantshop:${String(s.lines?.[0] ?? '').toLowerCase()}`, at: a, wall: w, face: [a[0] - w[0], 0, a[2] - w[2]], lines: [...s.lines], stand: Array.isArray(s.stand) ? at(...s.stand) : null }
  })
  r.plotId = plotId
  r.walkR = walkR
  r.builders_max = ENCHANT_BUILDERS
  return r
}

// ---- the fit-out ---------------------------------------------------------------------------------------------------------------
/** THE FURNISHINGS: each slot's furnishing (its request) by item. */
export const FURNISHING_OF = Object.freeze({ anvil: 'anvil', enchanting_table: 'table', bookshelf: 'shelves' })
/**
 * THE RECIPES (vanilla 1.21): out -> { n: made per craft, in: { name: count } }. 'planks' and 'log' are families (any species: the
 * fitter crafts the town's most-stocked species). obsidian, diamond, leather, sugar_cane, iron_ingot, log are RAW: never crafted here.
 */
export const FIT_RECIPES = Object.freeze({
  anvil: Object.freeze({ n: 1, in: Object.freeze({ iron_block: 3, iron_ingot: 4 }) }),
  iron_block: Object.freeze({ n: 1, in: Object.freeze({ iron_ingot: 9 }) }),
  enchanting_table: Object.freeze({ n: 1, in: Object.freeze({ book: 1, diamond: 2, obsidian: 4 }) }),
  bookshelf: Object.freeze({ n: 1, in: Object.freeze({ planks: 6, book: 3 }) }),
  book: Object.freeze({ n: 1, in: Object.freeze({ paper: 3, leather: 1 }) }),
  paper: Object.freeze({ n: 3, in: Object.freeze({ sugar_cane: 3 }) }),
  planks: Object.freeze({ n: 4, in: Object.freeze({ log: 1 }) }),
})
/** The bag names the fitter may spend (fit items and their made intermediates; never the bag's kit iron, its park cane or its wood). */
export const BAG_SPENDABLE = Object.freeze(new Set(['anvil', 'iron_block', 'enchanting_table', 'bookshelf', 'book', 'paper', 'obsidian', 'leather']))
const LOGS = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/
const PLANKS = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_planks$/
/** A {name: n} map with the wood families folded ('log', 'planks') -> {name: n}. Pure. */
export function familyCounts (m = {}) {
  const out = {}
  for (const [k, v] of Object.entries(m ?? {})) {
    const n = Number(v) || 0
    if (n <= 0) continue
    const f = LOGS.test(k) ? 'log' : PLANKS.test(k) ? 'planks' : k
    out[f] = (out[f] ?? 0) + n
  }
  return out
}
/**
 * WHAT THE FITTER MAY USE -> { bag: {name: n}, town: {name: n} } (families folded). Pure. The bag: BAG_SPENDABLE names only. The
 * town: everything it holds, less the keeps (IRON_KEEP iron ingots, DIAMOND_KEEP diamonds). An unknown town (null): only the bag.
 */
export function fitAvail (bag = {}, town = null, { ironKeep = IRON_KEEP, diamondKeep = DIAMOND_KEEP, owed = {} } = {}) {
  const b = {}
  for (const [k, v] of Object.entries(bag ?? {})) if (BAG_SPENDABLE.has(k) && (Number(v) || 0) > 0) b[k] = Number(v)
  // r1 (Codex code r1 BLOCKER): the fitter's OWN cargo (what an earlier visit drew and did not place or bank: an abort, a short draw,
  // a refused placement) is the bag's to spend too, up to what the bag still holds -- else 31 drawn iron read as 31 short for ever
  for (const [k, v] of Object.entries(cargoOwed(owed, bag))) if (!BAG_SPENDABLE.has(k)) b[k] = v
  const t = town ? familyCounts(town) : {}
  if (t.iron_ingot != null) t.iron_ingot = Math.max(0, t.iron_ingot - ironKeep)
  if (t.diamond != null) t.diamond = Math.max(0, t.diamond - diamondKeep)
  for (const k of Object.keys(t)) if (!(t[k] > 0)) delete t[k]
  return { bag: b, town: t }
}
/**
 * THE MATERIALS PLAN for `n` of `item` -> { ok, fromBag: {name: n}, take: {name: n} (from town), crafts: [{ item, count }] (deepest
 * first, in craft units of output), short: {raw: n} }. Pure. Uses what is held first (the bag, then the town) at every level, then
 * the recipe; a raw input nobody holds is SHORT. `avail` fitAvail's answer; it is not changed.
 */
export function fitPlan (item, n = 1, avail = { bag: {}, town: {} }) {
  const bag = { ...(avail?.bag ?? {}) }, town = { ...(avail?.town ?? {}) }
  const fromBag = {}, take = {}, crafts = [], short = {}
  const add = (m, k, v) => { if (v > 0) m[k] = (m[k] ?? 0) + v }
  const need = (name, count, depth) => {
    if (count <= 0) return
    if (depth > 6) { add(short, name, count); return }
    const b = Math.min(count, bag[name] ?? 0); if (b > 0) { bag[name] -= b; add(fromBag, name, b) }
    let left = count - b
    const t = Math.min(left, town[name] ?? 0); if (t > 0) { town[name] -= t; add(take, name, t) }
    left -= t
    if (left <= 0) return
    const r = FIT_RECIPES[name]
    if (!r) { add(short, name, left); return }
    const runs = Math.ceil(left / r.n)
    for (const [k, q] of Object.entries(r.in)) need(k, q * runs, depth + 1)
    crafts.push({ item: name, count: runs * r.n })
  }
  need(item, Math.max(0, Math.floor(Number(n) || 0)), 0)
  return { ok: Object.keys(short).length === 0, fromBag, take, crafts, short }
}
/** THE CARGO THE FITTER STILL OWES -> { name: n }: its cargo file clamped to the bag (a pickup never adds; what left the bag is gone
 *  from it). Pure. */
export function cargoOwed (cargo = {}, bag = {}) {
  const out = {}
  for (const [k, v] of Object.entries(cargo ?? {})) { const n = Math.min(Number(v) || 0, Number(bag?.[k]) || 0); if (n > 0) out[k] = n }
  return out
}
/** The cargo after a craft step -> { name: n }: the bag's change across the chain (`delta`: what it made up, what it used down -- the
 *  chain's inputs are the cargo's own) applied to the cargo, clamped to the bag (never the bag's own kit: 31 drawn iron crafted into an
 *  anvil leaves 0 owed, not the 3 kit ingots). Pure. */
export const cargoAfter = (cargo = {}, delta = {}, bag = {}) => {
  const m = { ...(cargo ?? {}) }
  for (const [k, v] of Object.entries(delta ?? {})) { const d = Number(v) || 0; if (d) m[k] = Math.max(0, (m[k] ?? 0) + d) }
  return cargoOwed(m, bag)
}
/** One slot's state from its cell's block -> 'placed' | 'open' | 'blocked' | 'unknown'. Pure. `b` { name } | null. */
export function slotState (slot, b) {
  if (!b) return 'unknown'
  const n = String(b.name ?? '')
  if (n === slot.item || (slot.item === 'anvil' && /^(chipped_|damaged_)?anvil$/.test(n))) return 'placed'
  if (n === 'air' || n === 'cave_air') return 'open'
  return 'blocked'
}
/**
 * THE FIT-OUT NOW -> [{ ...slot, state }] with state 'placed' | 'open' | 'blocked' | 'unknown' | 'lost' (stamped placed on the
 * record, now open: never rebuilt by itself). Pure over `read`.
 */
export function fitStates (rec, read) {
  const stamped = new Set(rec?.placed ?? [])
  return (rec?.fit ?? []).map(s => {
    let st = 'unknown'
    try { st = slotState(s, read(...s.at)) } catch { st = 'unknown' }
    // the ANVIL wears out (12% a use: anvil -> chipped -> damaged -> gone; anvilapply-01 uses it): a stamped anvil slot read open is
    // OPEN again -- a new anvil (31 iron above the keep) is filed and placed like the first (coordinator 11-04). Shelves and the table
    // never wear: one read open after its stamp is LOST (named, never rebuilt by itself)
    if (st === 'open' && stamped.has(s.slot) && s.item !== 'anvil') st = 'lost'
    return { ...s, state: st }
  })
}
/**
 * THE NEXT SLOT THE FITTER PLACES -> { slot, plan } | { slot: null, why }. Pure. In the record's order (anvil, table, shelves back
 * row first), the first OPEN slot whose plan for one unit is whole. A slot whose cell or gap is not readable is skipped.
 */
export function fitNext (states = [], avail = { bag: {}, town: {} }) {
  const open = states.filter(s => s.state === 'open')
  if (!open.length) return { slot: null, why: states.some(s => s.state === 'lost') ? 'lost_only' : states.length ? 'all_placed' : 'no_fit' }
  for (const s of open) {
    const plan = fitPlan(s.item, 1, avail)
    if (plan.ok) return { slot: s, plan }
  }
  return { slot: null, why: 'inputs_short' }
}
/**
 * THE GATES -> one per furnishing [{ fit, item, placed, of, open, lost, why: 'placed' | 'ok' | 'wait', short: {raw: n}, need }]. Pure.
 * `short` is the ROOT shortfall for EVERY slot of the furnishing still open (the request's size), `need` the root bill of those slots.
 */
export function fitGates (states = [], avail = { bag: {}, town: {} }) {
  const out = []
  for (const [item, fit] of Object.entries(FURNISHING_OF)) {
    const of = states.filter(s => s.item === item)
    if (!of.length) continue
    const placed = of.filter(s => s.state === 'placed').length
    const open = of.filter(s => s.state === 'open').length
    const lost = of.filter(s => s.state === 'lost').length
    const plan = open ? fitPlan(item, open, avail) : { ok: true, short: {} }
    const bill = open ? fitPlan(item, open, { bag: {}, town: {} }).short : {}
    // r1 (Codex code r1 note): 'placed' only when EVERY slot stands; nothing open but some blocked, unknown or lost is 'held' (the board
    // keeps its requests as they are)
    out.push({ fit, item, placed, of: of.length, open, lost, why: open ? (plan.ok ? 'ok' : 'wait') : placed === of.length ? 'placed' : 'held', short: plan.short, need: bill })
  }
  return out
}
const kv = m => Object.entries(m ?? {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(',') || '-'
/** `_enchantshop_gate` detail (requests.mjs reads it: fit, why, short, need). Pure. */
export const gateDetail = g => `fit=${g.fit} item=${g.item} why=${g.why} placed=${g.placed}/${g.of} open=${g.open} lost=${g.lost} short=${kv(g.short)} need=${kv(g.need)}`.slice(0, 300)
/** `_enchantshop_fit` detail. Pure. */
export const fitRowDetail = f => ['op', 'slot', 'item', 'at', 'took', 'crafted', 'placed', 'back', 'why', 'ms'].filter(k => f[k] !== undefined && f[k] !== null).map(k => `${k}=${typeof f[k] === 'object' && !Array.isArray(f[k]) ? kv(f[k]) : Array.isArray(f[k]) ? f[k].join(',') : f[k]}`).join(' ').slice(0, 300)
/** `_enchantshop_mode` detail. Pure. */
export const enchantModeDetail = (sw, rec = null) => `on=${sw.on ? 1 : 0} fit=${sw.fit ? 1 : 0} plot=${ENCHANT_PLOT} blueprint=${ENCHANT_BLUEPRINT} builders=${ENCHANT_BUILDERS} iron_keep=${IRON_KEEP} diamond_keep=${DIAMOND_KEEP} record=${rec ? (rec.structure_complete ? 'complete' : 'open') : 'none'}`
/** The one-cell record the fitter's visit places (buildrun runVisit) and its palette -> { record, palette }. Pure. */
export function fitVisitRecord (rec, slot) {
  return { record: { ...rec, cells: [{ at: slot.at.slice(), role: `fit_${slot.item}`, seg: 'fit' }], segments: [{ seg: 'fit', layer: 0, deps: [] }], clear: [], replant: [], fill: [] },
    palette: { [`fit_${slot.item}`]: [slot.item] } }
}
/** IS THE FITTER'S UPKEEP DUE -> bool. Pure over the readings. */
export function fitDue ({ on = true, complete = false, states = [], avail = null, now = 0, lastAt = -Infinity, idleUntil = 0, freeSlots = 36 } = {}) {
  if (!on || !complete || !avail) return false
  if (now - lastAt < FIT_GAP_MS || now < idleUntil) return false
  if (freeSlots < FIT_MIN_FREE) return false
  return !!fitNext(states, avail).slot
}
