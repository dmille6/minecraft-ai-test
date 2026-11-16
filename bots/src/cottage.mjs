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
import { styleOf, stylePalette, seedOf, WOODS, DARKNESS, logOf } from './townstyle.mjs'
import { isCottage2Blueprint, lookOf, frameOf, cottage2Id, cottageLooksFor, recordLook, lookCode, COTTAGE2_NEED, BEDS, WOOLS, BOX_PLANTS } from './cottage2.mjs'
import { cottageLooksAll } from './cottage2.mjs'   // homes-02show: every look of the family, for the search that resumes
import { COTTAGE_NAMES } from './homeplots.mjs'   // homes-01show: a cottage project for each of the layout's homes

export const COTTAGE_PLOT = 'cottage1'
/** The blueprint family: `cottage@1s` (eaves to the front) and `cottage@1f` (gable to the front). */
export const COTTAGE_VARIANTS = Object.freeze(['s', 'f'])
export const cottageBlueprintId = v => `cottage@1${v}`
export const isCottageBlueprint = id => /^cottage@1[sf]$/.test(String(id ?? '')) || isCottage2Blueprint(id)   // cottage2-01: the @2 family too
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
export const COTTAGE_NEED = Object.freeze({ roof: 32, wall: 16, stone: 64 })   // the roof takes ~18 logs: a contrast wood only with a margin (Claude r1 note)

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
  // cottage2-01: the doorway's u is the look's (a long eave-front cottage's door is at u 4); the first cottage's at u 3
  const l = lookOf(rec.blueprint), door = l ? frameOf(l.body, l.front).door : 3
  for (let u = door - 1; u <= door + 1; u++) for (let v = -depth; v <= 1; v++) { const { dx, dz } = rot(rec.orient, u, v); out.push([rec.anchor[0] + dx, rec.anchor[1] + dz]) }
  return out
}
/** THE PALETTE A RECORD IS BUILT AND JUDGED BY: its own (a styled record), else its blueprint's. Pure. */
// citywall-01 / civic-01: an upgraded wall generation (`citywall`) and a landmark (`civic`) carry their own palette too -- without a `style`,
// so the retrofit's one-at-a-time rule (reroof.mjs isStyled) never waits on them
export const recordPalette = (rec, bp) => (rec?.palette && typeof rec.palette === 'object' && (isCottageBlueprint(rec.blueprint) || (rec.style && typeof rec.style === 'object') || (rec.citywall && typeof rec.citywall === 'object') || (rec.civic && typeof rec.civic === 'object')) ? rec.palette : bp?.palette ?? {})
// townstyle-02: ANY STYLED record (a `style` chosen at siting: the town hall, a re-roofed generation) is judged by its own palette too

// ---- COTTAGE2-01: MORE COTTAGES, EACH ITS OWN LOOK; THE FURNISHING; THE WOOL ---------------------------------------------------
// (OWNER 11-08 "charm and uniqueness ... chests and beds"; cottage2.mjs is the blueprint family; design docs/reports/cottage2-design-2026-11-08.md)
/** The cottage projects in order: the first (its @1 blueprint, sited before cottage2-01) and two more on the extension's next house plots.
 *  homes-01show (homeplots.mjs COTTAGE_NAMES): in a town with a layout, one for each of the layout's homes (eight in the showcase:
 *  cottage1 .. cottage8), each still after the one before -- whatever HOMEPLOTS says (off: a later home never sited WAITS, one already
 *  sited is finished: homeplots.mjs laterHomeHeld); no layout: these three, as before. */
export const COTTAGE_PLOTS = COTTAGE_NAMES
export const isCottagePlot = plot => COTTAGE_PLOTS.includes(String(plot ?? ''))
/** The project each later cottage waits for (the order: one at a time, each after the one before stands). */
export const cottageAfterOf = plot => { const i = COTTAGE_PLOTS.indexOf(plot); return i > 0 ? COTTAGE_PLOTS[i - 1] : COTTAGE_AFTER }
/** THE SWITCH -> { on } for the LATER cottages (cottage2, cottage3) and their furnishing. COTTAGE2=on|off; unset = on only in
 *  COTTAGE2_POOLS (default 'showcase'). COTTAGE2=off: never offered, never sited; a sited record stays guarded. Pure. */
export function cottage2Switches (env = process.env, pool = '') {
  const pools = String(env?.COTTAGE2_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return { on: onOff(env?.COTTAGE2) ?? pools.includes(String(pool)) }
}
/**
 * THE STYLE AND LOOK OF A LATER COTTAGE -> { style, id } | null. Pure. `town` the indexed stock; `others` the sited cottage records (their
 * looks and woods: cottage2.mjs recordLook). THE WALL WOOD: a species the town holds COTTAGE2_NEED.wall logs of, chosen WITH the look so
 * the new cottage differs from every neighbour in two axes (cottageLookFor); THE ROOF: the darkest species darker than the walls the
 * town holds COTTAGE2_NEED.roof of, else the wall wood; THE STONE: stone bricks when held and the seed says so. null: no wood to build.
 */
export function cottage2Style (town = {}, opts = {}) {
  return cottage2Styles(town, { ...opts, n: 1 })[0] ?? null
}
/** The ranked styles (cottage2.mjs cottageLooksFor: up to `n`, each a different footprint or face) -> [{ style, id }]. Pure. */
export function cottage2Styles (town = {}, { pool = '', plot = 'cottage2', plotId = '', others = [], n = 3 } = {}) {
  const key = `${pool}/${plot}/${plotId}`
  const woods = WOODS.filter(w => (Number(town?.[logOf(w)]) || 0) >= COTTAGE2_NEED.wall)
  return cottageLooksFor(key, woods, others.map(recordLook).filter(Boolean), n).map(pick => styleOfPick(town, key, pick))
}
/** homes-02show: EVERY look a later cottage may be tried with on a plot, in the order tried (cottage2.mjs cottageLooksAll: the ranked
 *  picks of cottage2Styles first, then the rest of the family) -> [{ style, id }]. Pure. */
export function cottage2StylesAll (town = {}, { pool = '', plot = 'cottage2', plotId = '', others = [] } = {}) {
  const key = `${pool}/${plot}/${plotId}`
  const woods = WOODS.filter(w => (Number(town?.[logOf(w)]) || 0) >= COTTAGE2_NEED.wall)
  return cottageLooksAll(key, woods, others.map(recordLook).filter(Boolean)).map(pick => styleOfPick(town, key, pick))
}
function styleOfPick (town, key, pick) {
  const n = name => Number(town?.[name]) || 0
  const wood = pick.wood
  const darker = DARKNESS.slice(0, Math.max(0, DARKNESS.indexOf(wood)))
  const roof = darker.find(w => n(logOf(w)) >= COTTAGE2_NEED.roof) ?? wood
  const stone = n('stone_bricks') >= COTTAGE2_NEED.stone && (seedOf(key) & 1) ? 'stone_bricks' : 'cobblestone'
  return { style: { wood, roof, stone, variant: lookCode(pick.look) }, id: cottage2Id(pick.look) }
}
/**
 * DOES A FURNISHING CELL WAIT? -> bool. Pure. A cell of a cottage's `furnish` segment whose material neither the bag nor the town can
 * supply (`have(name)` -> what the two hold): a BED (or its head) while there is no bed and no 3 wool of one colour; a window-box FLOWER
 * while there is no flower or fern; a LANTERN while there is no lantern and no iron (an ingot or 8 nuggets) with a torch. A waiting cell
 * counts DONE for the visit's completion and is never damage: the cottage stands without it, and the first bot that can supply it
 * places it (a damaged read for that bot). A chest never waits (the bags carry them; the visit crafts one from planks).
 */
export function furnishWaits (cell, have = () => 0) {
  if (cell?.seg !== 'furnish') return false
  const h = nm => Math.max(0, Number(have(nm)) || 0)
  if (cell.role === 'bed' || cell.role === 'bedhead') return !(BEDS.some(b => h(b) >= 1) || WOOLS.some(w => h(w) >= 3))
  if (cell.role === 'flower') return !BOX_PLANTS.some(f => h(f) >= 1)
  if (cell.role === 'lamp') return !(h('lantern') >= 1 || ((h('iron_ingot') >= 1 || h('iron_nugget') >= 8) && h('torch') >= 1))
  return false
}
/** The beds a record owes (its bed FOOT cells not done) -> n. `done(cell)` the world's read. Pure. */
export const bedsOwed = (rec, done = () => false) => (rec?.cells ?? []).filter(c => c.role === 'bed' && !done(c)).length
/** THE WOOL a bed craft needs: the colour the bag + town hold at least 3 of, most first -> { colour, wool, bed } | null. Pure. */
export function bedColourFor (have = () => 0) {
  let best = null
  for (const w of WOOLS) { const n = Number(have(w)) || 0; if (n >= 3 && (!best || n > best.n)) best = { n, wool: w } }
  return best ? { colour: best.wool.replace(/_wool$/, ''), wool: best.wool, bed: best.wool.replace(/_wool$/, '_bed') } : null
}
/** THE COTTAGE'S CHESTS as town containers (chestfull.mjs setTownExtra: the stock view, the withdraw and kit searches, the index) ->
 *  ["x,y,z"]. Pure. */
export const cottageChestKeys = rec => (isCottageBlueprint(rec?.blueprint) ? (rec.cells ?? []).filter(c => c.role === 'chest' && Array.isArray(c.at)).map(c => c.at.join(',')) : [])
// ---- THE WOOL: SHEARING A SHEEP IN SIGHT ------------------------------------------------------------------------------------
/** The shear errand's bounds: a sheep within `seeR` of the bot and `homeR` of home; at most `max` sheep a visit; a bot asks at most every
 *  `everyMs`. Measured 11-08 (showcase, 20 h): 242 bot x 5-min windows saw a sheep within 40 b; 3 sheep within 200 b of home. */
export const SHEAR = Object.freeze({ seeR: 48, homeR: 128, max: 3, everyMs: 10 * 60_000, walkMs: 40_000, pickupMs: 4_000 })
/** A sheep entity's wool (mineflayer metadata index 17: the Sheep byte, colour in the low 4 bits, SHEARED 0x10) -> { sheared, colour } |
 *  null. Pure. Paper 11-08 (sandbox/cottage2/shear-e2e.mjs): a WHITE unsheared sheep sends NO byte (the default, 0, is never sent), so an
 *  absent index 17 is white and woolly; a non-number there is no read. */
export const SHEEP_WOOL_INDEX = 17
export function sheepWool (meta) {
  if (!Array.isArray(meta)) return null
  const b = meta[SHEEP_WOOL_INDEX] === undefined ? 0 : meta[SHEEP_WOOL_INDEX]
  if (!Number.isInteger(b)) return null
  return { sheared: (b & 0x10) !== 0, colour: b & 0x0f }
}
/** IS THE SHEAR ERRAND DUE for this bot? -> { due, why }. Pure. The cottage owes a bed that WAITS (no bed, no 3 wool of a colour), the bot
 *  holds shears, a woolly adult sheep is in sight (within SHEAR.seeR of the bot and SHEAR.homeR of home), and its last errand is older
 *  than SHEAR.everyMs. */
export function shearDue ({ owed = 0, waiting = false, shears = false, sheep = 0, lastAt = 0, now = Date.now() } = {}) {
  if (!(owed > 0)) return { due: false, why: 'no_bed_owed' }
  if (!waiting) return { due: false, why: 'wool_in_town' }
  if (!shears) return { due: false, why: 'no_shears' }
  if (!(sheep > 0)) return { due: false, why: 'no_sheep_in_sight' }
  if (now - (Number(lastAt) || 0) < SHEAR.everyMs) return { due: false, why: 'rested' }
  return { due: true, why: 'ok' }
}
/**
 * THE FURNITURE CRAFTS' BOOKING (the visit's bag balance: shop.mjs bagBalance, shopread G8) -> { name: delta }: the bag's change across the
 * crafts LESS what was withdrawn meanwhile (a take is booked as took). Every name in the bag before, after, OR withdrawn is counted --
 * Codex r1 BLOCKER: 6 wool drawn and crafted into 2 beds is in neither bag snapshot, and was never booked (G8 white_wool -6). Pure.
 */
export function furnitureCrafted (pre = {}, post = {}, took = {}, tookBefore = {}) {
  const out = {}
  for (const k of new Set([...Object.keys(pre), ...Object.keys(post), ...Object.keys(took)])) {
    const d = (Number(post[k]) || 0) - (Number(pre[k]) || 0) - ((Number(took[k]) || 0) - (Number(tookBefore[k]) || 0))
    if (d) out[k] = d
  }
  return out
}
