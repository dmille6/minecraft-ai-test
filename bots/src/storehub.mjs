// STOREHUB-01: THE TOWN STORAGE HUB -- pieces A (the sorted hall) and B (one clerk). OWNER 11-03: "a large storage area ... a few
// bots pulled stuff from our hopper chests and sorted them into another storage area with chests. stuff was sorted into groups and
// chests by the bots to keep things organized? other bots could pull from the sorted chests when they need things." / "a disposal
// well near this storage so sorting bots can throw away junk" -- "yes to all" (O1-O6, 11-03 ~21:30Z). Design
// docs/reports/storehub-design-2026-11-03.md sections 3.1, 3.3, 3.5; build notes docs/reports/storehub-ab-2026-11-04.md.
// PURE: the switches, the hall's sections and their chests, the siting plan, the record, the registry of hall chests, the clerk's
// classification, its source and its moves, the throw allowlist, the rows. Nothing here touches a bot, a window or a file; the
// visits are skills.mjs's (the hall: build_shop's ordinary blueprint visit; the signs: sortstore's label writer; the clerk: the
// storehouse tidy's verified withdraw + put, and the junk well's own throw).
//
// THE HALL (blueprints/storehub@1.json, docs/reports/storehub-ab-2026-11-04/make_storehub.py): the copper hall's shape (walls set back
// one cell, a step ring, stone course, plank course with glass bays, plank roof) on a 19 x 11 pad, 527 cells, a 3-wide doorway toward
// home; 18 SINGLE chests against the inner walls, one cell apart (two chests side by side would join), each with a wall sign above it
// naming its section (HALL_LAYOUT). It is sited BESIDE THE STOREHOUSE first (hubSitingPlan: every pad cell within HUB_SITE.storeGap of
// the storehouse's walls), then anywhere in the town ring; one blueprint record (`project-<home>.storehub`), built by two builders
// with the town's own cobblestone, stone bricks, planks and chests.
//
// THE REGISTRY (design 3.1, Claude review blocker 3): the hall stands outside the town box (16 from home), so its chests are named
// to the town's storage readers explicitly -- hubChestKeys(rec) -> chestfull.mjs setTownExtra -> inTown -- or moving stock into the
// hall would empty the town's stock view (stock targets, the cobble cap, the withdraw and kit searches, the index).
//
// THE CLERK (piece B; design 3.3): one bot at a time (the record's `clerk` lease), at most CLERK_STACKS stacks a visit, moves stacks
// from the town's other containers (the storehouse and its extra chests: today's intake) into the hall: each stack to its
// section's home, then the section's overflow, then the general OVERFLOW; an item no section knows to UNSORTED (never thrown); the
// owner's listed junk (HUB_THROWABLE, an allowlist) down the town well; never a kept kind (HUB_NEVER_THROW) thrown, whatever a list
// says. A stackable kind the clerk's bag already holds is never taken (Codex review blocker 3: its cargo would merge with the bot's
// own); its cargo is written to a per-holder file before the take, and delivered first on its next visit (cargoOwed).
//
// STOREHUB=off is the kill switch (never offered, never sited, no registry, no clerk). On only in STOREHUB_POOLS (default 'showcase').
// STOREHUB_CLERKS=0 stops the clerk alone; STOREHUB_WELL=off stops its well throws alone (junk then goes to UNSORTED);
// STOREHUB_SIGNS=off stops the labels.

import { groupOfItem } from './townindex.mjs'
import { rot } from './townplan.mjs'

export const HUB_PLOT = 'storehub'
export const HUB_BLUEPRINT = 'storehub@1'
export const HUB_BUILDERS = 2
/** The hall's earthwork (19 x 11 pad; the copper hall's 15 x 13 needed col 5 / 160 / 160 on the showcase's terrace). */
export const HUB_EARTH = Object.freeze({ col: 4, fill: 160, cut: 160 })
/** Siting: beside the storehouse first (every pad and ring cell within storeGap of its walls' box), then the town ring out to
 *  ringMax; the stands' domain is the pad + standPad; the town walk reaches walkR. */
// storehubsite-01 (LIVE showcase batch 4, 11-04 15:52Z on: 21 of 21 visits `no_site store:0 ring:0`): the ziggurat's apron (buildsite.mjs
// reservations `z0`: its record box + 8) covers the north field the offline run had found at 46 from home -- that run left z0 out. With
// it, no 19 x 11 site lies within 58; out to 72 the live state (pool + region copy 11-04 ~18Z) sites one at 57 (x 10..28, z -59..-49,
// the town's own level, 67 candidates screened). The walk reaches the ring's edge + 12.
export const HUB_SITE = Object.freeze({ storeGap: 12, footLen: 21, ringMin: 17, ringMax: 72, standPad: 4, walkR: 84 })

const onOff = v => { const s = String(v ?? '').trim().toLowerCase(); return ['on', '1', 'true', 'yes'].includes(s) ? true : ['off', '0', 'false', 'no'].includes(s) ? false : null }
/** THE SWITCHES -> { on, clerk, well, signs, clerks }. STOREHUB=on|off; unset = on only in STOREHUB_POOLS (default 'showcase'). Pure. */
export function hubSwitches (env = process.env, pool = '') {
  const pools = String(env?.STOREHUB_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  const on = onOff(env?.STOREHUB) ?? pools.includes(String(pool))
  const n = Number(String(env?.STOREHUB_CLERKS ?? '').trim() || 1)
  const clerks = Number.isFinite(n) ? Math.max(0, Math.min(1, Math.floor(n))) : 1   // one clerk (owner O4); a second is a later piece
  return { on, clerks: on ? clerks : 0, clerk: on && clerks > 0, well: on && onOff(env?.STOREHUB_WELL) !== false, signs: on && onOff(env?.STOREHUB_SIGNS) !== false }
}
export const hubModeDetail = (sw, rec = null) => `on=${sw.on ? 1 : 0} clerk=${sw.clerk ? 1 : 0} clerks=${sw.clerks} well=${sw.well ? 1 : 0} signs=${sw.signs ? 1 : 0} plot=${HUB_PLOT} blueprint=${HUB_BLUEPRINT} chests=${HALL_LAYOUT.length} record=${rec ? (rec.structure_complete ? 'complete' : 'open') : 'none'} stacks=${CLERK_STACKS}`

// ---- the sections ------------------------------------------------------------------------------------------------------------
/** Plant caps per type (owner O2: a plants section with per-type caps): a sapling or propagule 64, bamboo 128, a flower 32. */
export const PLANT_CAPS = Object.freeze({ sapling: 64, bamboo: 128, flower: 32 })
const FLOWERS = /^(dandelion|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|torchflower|sunflower|lilac|rose_bush|peony|pink_petals|wildflowers|wither_rose|spore_blossom|pitcher_plant)$/
const PLANTS = /(_sapling$|_propagule$|^bamboo$|^azalea$|^flowering_azalea$)/
const FOOD = /^(apple|golden_apple|bread|carrot|golden_carrot|potato|baked_potato|beetroot|melon_slice|sweet_berries|glow_berries|cookie|pumpkin_pie|cake|dried_kelp|honey_bottle|mushroom_stew|beetroot_soup|rabbit_stew|(cooked_)?(beef|porkchop|chicken|mutton|rabbit|cod|salmon))$/
/**
 * THE SECTIONS -> { id: { label, group } }: the hall's own groups. Ten are the town plan's (townindex.mjs GROUP_ORDER, so a stack
 * goes where the town index already says it belongs); food, plants and farming split the plan's `farm` group (the owner's list:
 * "stone, wood, ores/ingots, tools, food, plants, farming, building blocks"); `overflow` takes any known item whose homes are full;
 * `unsorted` takes what no section knows. Sign text: at most 15 characters a line.
 */
export const HUB_SECTIONS = Object.freeze({
  stone: Object.freeze({ label: ['STONE', 'bricks, stone', 'deepslate'] }),
  wood: Object.freeze({ label: ['WOOD', 'logs, planks', 'sticks'] }),
  metal: Object.freeze({ label: ['ORES & INGOTS', 'iron, copper', 'gold'] }),
  fuel: Object.freeze({ label: ['FUEL', 'coal, charcoal'] }),
  valuable: Object.freeze({ label: ['VALUABLES', 'diamond, lapis', 'redstone'] }),
  tools: Object.freeze({ label: ['TOOLS', 'picks, axes', 'shovels'] }),
  build: Object.freeze({ label: ['BUILDING', 'torches, glass', 'stations'] }),
  earth: Object.freeze({ label: ['EARTH', 'dirt, sand', 'gravel, clay'] }),
  food: Object.freeze({ label: ['FOOD', 'bread, apples', 'cooked meat'] }),
  farming: Object.freeze({ label: ['FARMING', 'seeds, wheat', 'bone meal'] }),
  plants: Object.freeze({ label: ['PLANTS', 'saplings', 'bamboo, flowers'] }),
  overflow: Object.freeze({ label: ['OVERFLOW', 'anything', 'when full'] }),
  unsorted: Object.freeze({ label: ['UNSORTED', 'to be sorted'] }),
})
/**
 * THE HALL'S CHESTS by blueprint cell (u, v) -> section and role ('home' | 'more': the section's own overflow). The back row (the
 * one a bot faces coming in) holds the four busiest sections twice; the front row and the side walls the rest. 18 chests, the
 * blueprint's `chests` exactly (a test asserts it).
 */
export const HALL_LAYOUT = Object.freeze([
  [2, 8, 'stone', 'home'], [4, 8, 'stone', 'more'], [6, 8, 'wood', 'home'], [8, 8, 'wood', 'more'],
  [10, 8, 'metal', 'home'], [12, 8, 'metal', 'more'], [14, 8, 'tools', 'home'], [16, 8, 'tools', 'more'],
  [2, 2, 'fuel', 'home'], [4, 2, 'valuable', 'home'], [6, 2, 'build', 'home'], [12, 2, 'build', 'more'],
  [14, 2, 'earth', 'home'], [16, 2, 'unsorted', 'home'],
  [2, 4, 'food', 'home'], [2, 6, 'farming', 'home'], [16, 4, 'plants', 'home'], [16, 6, 'overflow', 'home'],
].map(([u, v, section, role]) => Object.freeze({ u, v, section, role })))

/** THE SECTION of an item name -> a HUB_SECTIONS id (never 'overflow'). Pure. */
export function hubSectionOf (name) {
  const n = String(name ?? '')
  if (!n) return 'unsorted'
  if (FOOD.test(n)) return 'food'
  if (PLANTS.test(n) || FLOWERS.test(n)) return 'plants'
  const g = groupOfItem(n)
  if (g === 'farm') return 'farming'
  if (g === 'misc') return 'unsorted'
  return HUB_SECTIONS[g] ? g : 'unsorted'
}
/** A plant's cap in the PLANTS section -> n | null (not a plant). Pure. */
export function plantCap (name) {
  const n = String(name ?? '')
  if (n === 'bamboo') return PLANT_CAPS.bamboo
  if (/(_sapling|_propagule)$/.test(n) || n === 'azalea' || n === 'flowering_azalea') return PLANT_CAPS.sapling
  if (FLOWERS.test(n)) return PLANT_CAPS.flower
  return null
}

// ---- the throw allowlist (design 3.5; the tripwire's SH1 judges the same lists) ------------------------------------------------
/** THE ONLY NAMES A CLERK THROWS: the owner's 10-04 junk list and the scaffold decorations (well.mjs OWNER_JUNK_1004 +
 *  SCAFFOLD_DECORATIONS, copied: a test asserts equality). DECORATIONS (wool, stained glass, bricks, buttons, fences) are NOT
 *  thrown from hub cargo: in entrusted stock they are building material (they go to BUILDING or UNSORTED). */
export const HUB_THROWABLE = Object.freeze(['egg', 'brown_egg', 'blue_egg', 'flint', 'clay_ball', 'ink_sac', 'glow_ink_sac',
  'armadillo_scute', 'dead_bush', 'pointed_dripstone', 'rail', 'andesite', 'diorite', 'granite', 'mossy_cobblestone'])
const THROWABLE = new Set(HUB_THROWABLE)
/** NEVER THROWN from hub cargo, whatever a list says (design 3.5): tools and swords, ores, raw metal, ingots, logs, planks, wood,
 *  fuel, building stone and bricks, glass, copper, food, saplings, bamboo, flowers. A second guard under the allowlist. */
export const HUB_NEVER_THROW = /(_(pickaxe|axe|shovel|hoe|sword)$|_ore$|^raw_|_ingot$|_nugget$|_log$|_wood$|_planks$|_stem$|^stick$|^(coal|charcoal|coal_block)$|^(cobblestone|cobbled_deepslate|stone|stone_bricks|smooth_stone|deepslate|tuff|blackstone|sandstone|red_sandstone|bricks?)$|glass|copper|_sapling$|_propagule$|^bamboo|^(diamond|emerald|lapis_lazuli|redstone|quartz)$|^(torch|chest|crafting_table|furnace|bucket|water_bucket|shears|flint_and_steel)$)/
/** May the clerk throw this name down the well? On HUB_THROWABLE, off HUB_NEVER_THROW, and the well's own isWellJunk (`isJunk`,
 *  passed in: well.mjs is the source of that rule). Pure. */
export const hubThrowable = (name, isJunk = () => true) => typeof name === 'string' && THROWABLE.has(name) && !HUB_NEVER_THROW.test(name) && !!isJunk(name)
/** Is this name a KEPT kind (never thrown by a clerk)? Pure. The tripwire's SH1 kept_thrown: a clerk throw of a name for which this
 *  is true, or of a name off HUB_THROWABLE. */
export const hubKept = name => !THROWABLE.has(String(name ?? '')) || HUB_NEVER_THROW.test(String(name ?? ''))

// ---- the siting --------------------------------------------------------------------------------------------------------------
/** The Chebyshev gap between two [x0, z0, x1, z1] boxes (0: they touch or overlap) -> n | Infinity (a box missing). Pure. */
export function boxGap (a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 4 || b.length !== 4) return Infinity
  const dx = Math.max(0, b[0] - a[2], a[0] - b[2]), dz = Math.max(0, b[1] - a[3], a[1] - b[3])
  return Math.max(dx, dz)
}
const padBox = pad => { const xs = pad.map(c => c[0]), zs = pad.map(c => c[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] }
/**
 * THE SITING PLAN -> [{ source, domain, standDomain, line, walkR, earth, rankKey }] in the order to try. Pure.
 *   1. 'store' (only with a storehouse record): every pad and ring cell within HUB_SITE.storeGap of the storehouse's box, nearest
 *      the storehouse first (the owner: "next to the existing storehouse");
 *   2. 'ring': the town ring, Chebyshev >= ringMin from home, out to ringMax, nearest home first.
 * The reservations (the plan, every record + PROJECT_GAP, the zones) are the caller's ctx, as every project's.
 */
export function hubSitingPlan (home, store = null) {
  const steps = []
  const line = HUB_SITE.ringMax
  const near = (x, z) => Math.hypot(x - home.x, z - home.z) <= line
  const sb = Array.isArray(store?.box) && store.box.length === 4 ? store.box : null
  if (sb) {
    // the footprint's NEAR edge within storeGap (the caller refuses a site whose pad is farther: hubBeside); its far edge up to a
    // footprint's length beyond
    const reach = HUB_SITE.storeGap + HUB_SITE.footLen
    const dom = (x, z) => near(x, z) && boxGap([x, z, x, z], sb) <= reach
    steps.push({ source: 'store', domain: dom, standDomain: (x, z) => near(x, z) && boxGap([x, z, x, z], sb) <= reach + HUB_SITE.standPad, line, walkR: HUB_SITE.walkR, earth: HUB_EARTH,
      rankKey: site => boxGap(padBox(site.pad), sb), beside: site => boxGap(padBox(site.pad), sb) <= HUB_SITE.storeGap })
  }
  const ring = (x, z) => near(x, z) && Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) >= HUB_SITE.ringMin
  steps.push({ source: 'ring', domain: ring, standDomain: (x, z) => Math.hypot(x - home.x, z - home.z) <= line + HUB_SITE.standPad, line, walkR: HUB_SITE.walkR, earth: HUB_EARTH,
    rankKey: site => Math.round(Math.max(...site.pad.map(([x, z]) => Math.hypot(x - home.x, z - home.z))) / 4) })
  return steps
}
/** The stands' domain for a sited hall's visits: its box + HUB_SITE.standPad (the step ring, the doorway's approach). Pure. */
// storehubstand-01 (LIVE showcase a7efcca2, 11-04 18:57-21:00Z: 46 hall visits, 0 placed -- 47 `replanned`, 32 aborted): the siting
// proved the felled trees' REPLANT cells with the ring's stand domain (hubSitingPlan: within ringMax + standPad of home), and they lie
// outside the pad (x -1..19, z -48..-41 and 17,69,-67 for a pad at x 10..28, z -59..-49). The visit's domain was the pad + 4 alone, so
// stepFor found no stand for any replant, each visit moved one (`replant_moved ... why=no_step`) and stopped, and the trees were
// never felled: the earthwork and every wall wait behind them. The visit now stands where the siting stood.
export function hubStandDomain (rec) {
  const b = rec?.box
  if (!Array.isArray(b) || b.length !== 4) return () => false
  const p = HUB_SITE.standPad
  const home = rec.home, far = HUB_SITE.ringMax + p
  const ring = home && Number.isFinite(home.x) && Number.isFinite(home.z) ? (x, z) => Math.hypot(x - home.x, z - home.z) <= far : () => false
  return (x, z) => (x >= b[0] - p && x <= b[2] + p && z >= b[1] - p && z <= b[3] + p) || ring(x, z)
}
/**
 * storehubwalk-01 (LIVE 8b4ea9cc, 11-04 22:54-23:54Z: 0 placements, 33 of 70 visits aborted -- 23 `timeout` -- and the others 160-190 s
 * long): a build visit's own deadline was t0 + SHOP_VISIT_MS (8 min) - 15 s, but the runner's watchdog ends every skill at
 * SKILL_TIMEOUT_MS (180 s on the showcase): the hall, 57 blocks out through forest, was cut mid-walk before the visit's clock ever
 * ended it. THE HALL'S VISIT BUDGET -> ms: the smaller of the two clocks, less HUB_VISIT_TAIL_MS (the leftovers' bank-back and the
 * walk home are the visit's, not the watchdog's). Pure.
 */
export const HUB_VISIT_TAIL_MS = 40_000
export const hubVisitBudget = (runnerMs, visitMs) => {
  const r = Number(runnerMs) > 0 ? Number(runnerMs) : Infinity, v = Number(visitMs) > 0 ? Number(visitMs) : Infinity
  const m = Math.min(r, v)
  return Number.isFinite(m) ? Math.max(30_000, m - HUB_VISIT_TAIL_MS) : 8 * 60_000
}
/** A BUILD VISIT'S STATUS -> 'success' | 'no_effect': a block placed; for the hall also a tree felled, a sapling replanted or a cell
 *  cleared (its far site's preparation runs over several clock-bounded visits, and a no_effect visit marks the project idle for an
 *  hour: shop.mjs noteIdle -- Codex storehubwalk r1 BLOCKER 1). Pure. */
export const hubVisitStatus = (hub, r) => ((Number(r?.placed) || 0) > 0 || (hub && ((Number(r?.cleared) || 0) > 0 || (Number(r?.planted) || 0) > 0)) ? 'success' : 'no_effect')
/** A builder this far (horizontally) from the hall's doorway COMMUTES first: one `goto` (the town's own leg-by-leg travel) to the
 *  doorway's front cell, then the visit's stand walks are short. LIVE 8b4ea9cc: stand walks of 57+ blocks through forest from the
 *  town chests (buildbot.mjs walkTo: one pathfinder goal, PATH_MS 25 s) ended `_pathfinder_wedged` (an empty path held 211 s). */
export const HUB_COMMUTE_FROM = 20
/** THE COMMUTE -> { target: [x, y, z], dist } | null (near enough, or no record). Pure. The doorway's front cell: the pad's
 *  door column (u 9, v 0) at s + 1, before the 3-wide doorway. */
export function hubCommute (rec, pos) {
  if (rec?.blueprint !== HUB_BLUEPRINT || !pos || !Array.isArray(rec.anchor) || !Number.isFinite(rec.s) || !rec.orient) return null
  const target = cellAt(rec, 9, 0, 1)
  const dist = Math.hypot(pos.x - (target[0] + 0.5), pos.z - (target[2] + 0.5))
  return dist > HUB_COMMUTE_FROM ? { target, dist } : null
}
/** The build visit's options for a hall record (buildrun.mjs runVisit: the stands' domain and the walk's radius). Pure. */
export const hubVisitOpts = rec => (rec?.blueprint === HUB_BLUEPRINT ? { domain: hubStandDomain(rec), walkR: Number.isFinite(rec.walkR) ? rec.walkR : HUB_SITE.walkR } : {})

/** A blueprint cell (u, v, y) of a record -> world [x, y, z]. Pure. */
const cellAt = (rec, u, v, y) => { const { dx, dz } = rot(rec.orient, u, v); return [rec.anchor[0] + dx, rec.s + y, rec.anchor[1] + dz] }
/**
 * THE RECORD a siting result becomes -> the record, plus `chests`: [{ at, section, role, stand, wall }] (HALL_LAYOUT in world
 * cells: the chest, its aisle stand, the wall cell behind its sign), `walkR`, `band` (the siting step's source). Pure.
 */
export function hubRecordOf (siteRec, bp, { band = null } = {}) {
  const rec = { ...siteRec, builders_max: HUB_BUILDERS, walkR: HUB_SITE.walkR, ...(band ? { band } : {}) }
  rec.chests = hubChestsOf(rec)
  return rec
}
/** The hall's chests of a record (anchor, orient, s) -> [{ at, section, role, stand, wall, sign }]. Pure. */
export function hubChestsOf (rec) {
  if (!rec || !Array.isArray(rec.anchor) || !Number.isFinite(rec.s) || !rec.orient) return []
  return HALL_LAYOUT.map(c => {
    // the wall behind the chest (the sign's wall) and the aisle cell in front (its stand): the blueprint's walls are v 1 / v 9, u 1 / u 17
    const [wu, wv] = c.v === 8 ? [c.u, 9] : c.v === 2 ? [c.u, 1] : c.u === 2 ? [1, c.v] : [17, c.v]
    const [su, sv] = c.v === 8 ? [c.u, 7] : c.v === 2 ? [c.u, 3] : c.u === 2 ? [3, c.v] : [15, c.v]
    return { at: cellAt(rec, c.u, c.v, 1), section: c.section, role: c.role, stand: cellAt(rec, su, sv, 1), wall: cellAt(rec, wu, wv, 2), sign: cellAt(rec, c.u, c.v, 2) }
  })
}
const kOf = a => `${a[0]},${a[1]},${a[2]}`
/**
 * THE HALL'S WAY IN -> [[x, z]] (the showcase gkaccess fold, Codex fold BLOCKER: access-01's staircases read a build's `door` /
 * `frontOpen`, and a hall record names neither -- a climb before the doorway could become a stone stair across it). The doorway's
 * columns (blueprint u 8..10, v 1) and the approach before it (v 0 down to -HUB_APPROACH), one column wider each side. Pure; a record
 * that is not a placed hall gives none.
 */
export const HUB_APPROACH = 3
export function hubEntranceCols (rec, { depth = HUB_APPROACH } = {}) {
  if (rec?.blueprint !== HUB_BLUEPRINT || !Array.isArray(rec.anchor) || !rec.orient) return []
  const out = []
  for (let u = 7; u <= 11; u++) for (let v = -depth; v <= 1; v++) { const { dx, dz } = rot(rec.orient, u, v); out.push([rec.anchor[0] + dx, rec.anchor[1] + dz]) }
  return out
}
/** THE REGISTRY: the hall's chest keys -> Set("x,y,z") (the record's own `chests`, else computed). STOREHUB=off: empty. Pure. */
export function hubChestKeys (rec, { on = true } = {}) {
  if (!on || rec?.blueprint !== HUB_BLUEPRINT) return new Set()
  const cs = Array.isArray(rec.chests) && rec.chests.length ? rec.chests : hubChestsOf(rec)
  return new Set(cs.filter(c => Array.isArray(c?.at) && c.at.length === 3).map(c => kOf(c.at)))
}
/** THE HALL'S HOMES -> { byKey: Map k -> { section, role }, homeOf: Map section -> [k] (home first, then 'more'), overflow: [k],
 *  unsorted: [k] }. Pure. */
export function hubHomes (rec) {
  const byKey = new Map(), homeOf = new Map(), overflow = [], unsorted = []
  const cs = rec?.blueprint === HUB_BLUEPRINT ? (Array.isArray(rec.chests) && rec.chests.length ? rec.chests : hubChestsOf(rec)) : []
  for (const c of [...cs].sort((a, b) => (a.role === 'home' ? 0 : 1) - (b.role === 'home' ? 0 : 1))) {
    if (!Array.isArray(c?.at)) continue
    const k = kOf(c.at)
    byKey.set(k, { section: c.section, role: c.role })
    if (c.section === 'overflow') overflow.push(k)
    else if (c.section === 'unsorted') unsorted.push(k)
    else { if (!homeOf.has(c.section)) homeOf.set(c.section, []); homeOf.get(c.section).push(k) }
  }
  return { byKey, homeOf, overflow, unsorted }
}
/** THE LABEL SPOTS of a complete hall -> sortstore.mjs signSpots' shape [{ chest, at, wall, face, lines, stand }]. Pure. */
export function hubSignSpots (rec) {
  if (rec?.blueprint !== HUB_BLUEPRINT) return []
  const cs = Array.isArray(rec.chests) && rec.chests.length ? rec.chests : hubChestsOf(rec)
  return cs.filter(c => Array.isArray(c?.sign) && Array.isArray(c?.wall)).map(c => ({
    chest: kOf(c.at), at: c.sign.slice(), wall: c.wall.slice(), face: [c.sign[0] - c.wall[0], 0, c.sign[2] - c.wall[2]],
    lines: (HUB_SECTIONS[c.section]?.label ?? [String(c.section).toUpperCase()]).slice(0, c.role === 'more' ? 1 : 4).concat(c.role === 'more' ? ['(more)'] : []),
    stand: Array.isArray(c.stand) ? c.stand.slice() : null,
  }))
}

// ---- the clerk (piece B) -----------------------------------------------------------------------------------------------------
/** NEVER MOVED BY THE CLERK (Codex design 11-04 item 3): cobblestone is the town's bulk working stone -- the builders' draws, the
 *  yard's clerk (yard.mjs YARD_CHEST_KEEP 320, its piles) and the cobble cap own it; the hall's STONE section holds the rest. */
export const CLERK_LEAVE = Object.freeze(new Set(['cobblestone']))
/** Stacks a clerk visit carries at most (sortstore.mjs SORT_MOVE_STACKS), and the bag slots it keeps free. */
export const CLERK_STACKS = 6
export const CLERK_BAG_SPARE = 4
/** A clerk's term and rest (design 3.3: a 60-min term, then 30 min off; another bot takes the lease meanwhile). */
export const CLERK_TERM_MS = 60 * 60_000
export const CLERK_REST_MS = 30 * 60_000
/** A bot's clerk visits at most this often, and a visit that moved nothing rests its clerk work this long. */
export const CLERK_GAP_MS = 3 * 60_000
export const CLERK_IDLE_MS = 15 * 60_000
/** A source move that failed is not planned again by this bot for this long (per source and name). */
export const CLERK_BACKOFF_MS = 30 * 60_000
/** The lease's life (renewed each visit). */
export const CLERK_LEASE_MS = 12 * 60_000

/**
 * WHERE A STACK GOES -> { to: 'hall' | 'well' | 'stay', section, why }. Pure. In order (a category is not permission to store: Codex):
 *   a HUB_THROWABLE name (and isWellJunk) with the well on -> 'well' (with the well off: UNSORTED, never thrown);
 *   a plant at or over its PLANTS cap (`plantsHeld`: the PLANTS chests' count of it) -> 'stay';
 *   everything else -> 'hall', its section (an unknown item: 'unsorted').
 */
export function clerkRoute (name, { well = true, isJunk = () => true, plantsHeld = 0 } = {}) {
  if (hubThrowable(name, isJunk)) return well ? { to: 'well', section: null, why: 'junk' } : { to: 'hall', section: 'unsorted', why: 'junk_well_off' }
  const section = hubSectionOf(name)
  const cap = section === 'plants' ? plantCap(name) : null
  if (cap != null && (Number(plantsHeld) || 0) >= cap) return { to: 'stay', section, why: 'plant_cap' }
  return { to: 'hall', section, why: section === 'unsorted' ? 'unknown' : 'sorted' }
}
/** The hall chests a section's stacks try, in order -> [k]: its homes (home, then more), the general OVERFLOW; UNSORTED's own chests
 *  for an unknown item (then OVERFLOW); never another section's home. Pure. */
export function clerkTargets (homes, section) {
  if (!homes) return []
  if (section === 'unsorted') return [...homes.unsorted, ...homes.overflow]
  return [...(homes.homeOf.get(section) ?? []), ...homes.overflow]
}
/**
 * THE CLERK'S MOVES -> { from, moves: [{ name, slots, count, to: k | 'well', section, why }], skipped: { why: n } } | null. Pure.
 *   entries   the town index's KNOWN entries { k: { names: { name: [count, slots] }, used, size } } (the caller filters: fresh only)
 *   hubKeys   the hall's chest keys: a hall chest is a source of its MISPLACED stacks only (another section's; out of OVERFLOW or
 *             UNSORTED into a section's own homes), after every town chest; `sources`: the town chests that may be sources (the
 *             town box's containers, the workshop's materials chests and protected zones already out: the caller's)
 *   held      the clerk's bag { name: n } (a stackable name it holds is never taken: no merge); `stackable(name)` -> bool
 *   maxSlots  stacks this visit may carry (bag free less CLERK_BAG_SPARE), at most CLERK_STACKS
 *   skip      (from, name) => bool: a move in its back-off
 *   well, isJunk: clerkRoute's
 * The town's chests first, then the source with the most movable slots (one source a visit, as the storehouse tidy), and ONE
 * destination class a visit (the well or the hall: they lie apart). Cobblestone never moves (CLERK_LEAVE). A hall target must show a
 * free slot in its entry after the moves planned (an unknown hall chest -- no entry yet -- is taken as empty: the hall is new and
 * the put verifies against the server).
 */
export function clerkMoves (homes, entries = {}, { hubKeys = new Set(), sources = null, held = {}, stackable = () => true, maxSlots = CLERK_STACKS, skip = () => false, well = true, isJunk = () => true } = {}) {
  if (!homes || !(maxSlots > 0)) return null
  const free = new Map()
  for (const k of homes.byKey.keys()) {
    const e = entries?.[k]
    free.set(k, Number.isFinite(e?.size) && Number.isFinite(e?.used) ? Math.max(0, e.size - e.used) : 27)
  }
  const plants = {}
  for (const k of homes.homeOf.get('plants') ?? []) for (const [n, v] of Object.entries(entries?.[k]?.names ?? {})) plants[n] = (plants[n] ?? 0) + (Number(v?.[0]) || 0)
  const skipped = {}
  const cands = []
  for (const [from, e] of Object.entries(entries ?? {})) {
    // a HALL chest is a source of its MISPLACED stacks only (a depositor's or a player's stack in the wrong section); a town chest
    // (the `sources`: the town box's) of every stack the hall takes
    const own = homes.byKey.get(from) ?? (hubKeys.has(from) ? { section: null } : null)
    if ((!own && sources && !sources.has(from)) || !e?.names) continue
    const moves = []
    for (const [name, v] of Object.entries(e.names)) {
      const count = Number(v?.[0]) || 0, slots = Number(v?.[1]) || 0
      if (!(count > 0) || !(slots > 0)) continue
      if (CLERK_LEAVE.has(name)) { skipped.leave = (skipped.leave ?? 0) + 1; continue }
      if (skip(from, name)) { skipped.backoff = (skipped.backoff ?? 0) + 1; continue }
      // NO MERGE (Codex review blocker 3): a stackable kind the bag holds is never taken; a tool the bag holds neither (the put's
      // count floor could bank the bot's own copy and keep the town's: sortstore's sortHeldUnstackable rule)
      if ((Number(held?.[name]) || 0) > 0) { skipped.held = (skipped.held ?? 0) + 1; continue }
      const r = clerkRoute(name, { well, isJunk, plantsHeld: plants[name] ?? 0 })
      if (r.to === 'stay') { skipped[r.why] = (skipped[r.why] ?? 0) + 1; continue }
      let only = null
      if (own) {
        if (!own.section) continue
        // in its place: its own section's chest; an unknown item in UNSORTED; anything in OVERFLOW whose homes are full (below)
        if (r.to === 'hall' && r.section === own.section) continue
        if (own.section === 'unsorted' && r.to === 'hall' && r.section === 'unsorted') continue
        // out of OVERFLOW / UNSORTED: only into the section's own homes (never OVERFLOW again)
        if (own.section === 'overflow' || own.section === 'unsorted') only = homes.homeOf.get(r.section) ?? []
      }
      moves.push({ name, slots, count, ...r, ...(only ? { only } : {}) })
    }
    if (!moves.length) continue
    // ONE DESTINATION CLASS A VISIT (Codex design 11-04 item 3): the well and the hall lie apart; the class with more slots goes
    const wellSlots = moves.filter(m => m.to === 'well').reduce((t, m) => t + m.slots, 0), hallSlots = moves.filter(m => m.to !== 'well').reduce((t, m) => t + m.slots, 0)
    const cls = wellSlots > hallSlots ? moves.filter(m => m.to === 'well') : moves.filter(m => m.to !== 'well')
    cands.push({ from, moves: cls, n: cls.reduce((t, m) => t + m.slots, 0), hall: !!own })
  }
  // the town's chests before the hall's own (migration first), then the most movable slots
  cands.sort((a, b) => (a.hall ? 1 : 0) - (b.hall ? 1 : 0) || b.n - a.n || (a.from < b.from ? -1 : 1))
  for (const c of cands) {
    const left = new Map(free)
    let budget = Math.min(maxSlots, CLERK_STACKS)
    const out = []
    for (const m of c.moves.sort((a, b) => b.slots - a.slots || (a.name < b.name ? -1 : 1))) {
      if (budget <= 0) break
      let to = null
      if (m.to === 'well') to = 'well'
      else to = (m.only ?? clerkTargets(homes, m.section)).find(k => k !== c.from && (left.get(k) ?? 0) > 0) ?? null
      if (!to) { skipped.hall_full = (skipped.hall_full ?? 0) + 1; continue }
      const room = to === 'well' ? Infinity : left.get(to)
      const slots = Math.min(m.slots, budget, room)
      const count = slots >= m.slots ? m.count : Math.floor(m.count * slots / m.slots)
      if (!(count > 0)) continue
      if (to !== 'well') left.set(to, left.get(to) - slots)
      budget -= slots
      out.push({ name: m.name, slots, count, to, section: m.section, why: m.why })
    }
    if (out.length) return { from: c.from, moves: out, skipped }
  }
  return null
}
/** THE CARGO A HOLDER OWES -> { name: n }: the cargo file's counts, each no more than the bag holds now (the bag is the truth; what is
 *  gone was delivered or lost, and the visit's row said which). Pure. */
export function cargoOwed (cargo = {}, held = {}) {
  const out = {}
  for (const [n, c] of Object.entries(cargo ?? {})) { const v = Math.min(Math.floor(Number(c) || 0), Math.floor(Number(held?.[n]) || 0)); if (v > 0) out[n] = v }
  return out
}
/** The names a holder's cargo makes KEEPS for every other bag rule (the well's dispose, the town deposit) -> [name]: every owed name,
 *  except (for the clerk's own well throw: `forWell`) the names it is throwing. Pure. */
export const cargoKeeps = (owed = {}, { forWell = false, isJunk = () => true } = {}) => Object.keys(owed).filter(n => !(forWell && hubThrowable(n, isJunk)))
/** THE CLERK THROW'S KEEP for a bag -> [name]: every name the bag holds but `only` (its cargo's junk, each HUB_THROWABLE), so a
 *  decoration picked up on the walk to the well is never thrown (well.mjs disposePlan's `keep`; Codex code r1 BLOCKER 2). Pure. */
export const clerkKeepOf = (bag = [], only = [], isJunk = () => true) => {
  const ok = new Set((only ?? []).filter(n => hubThrowable(n, isJunk)))
  return [...new Set((bag ?? []).map(it => it?.name).filter(n => n && !ok.has(n)))]
}
/** THE CLERK'S WORK FOR A BOT NOW -> 'cargo' | 'move' | null. Pure. */
export function clerkWork ({ on = true, owed = {}, plan = null, restUntil = 0, lastAt = -Infinity, now = Date.now() } = {}) {
  if (!on) return null
  if (Object.keys(owed).length) return 'cargo'
  if (now < (Number(restUntil) || 0) || now - (Number(lastAt) || -Infinity) < CLERK_GAP_MS) return null
  return plan ? 'move' : null
}
/** The `_storehub_clerk` row's detail (the read's and the tripwire's fields first: junked= names every throw). Pure. */
export function clerkRowDetail ({ phase = 'visit', src = '-', took = {}, sorted = {}, homes = 0, more = 0, overflow = 0, unsorted = 0, junked = {}, back = {}, cargoLeft = {}, stop = '-', ms = 0, skipped = {} } = {}) {
  const f = m => Object.entries(m ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(',') || '-'
  return `phase=${phase} junked=${f(junked)} src=${src} took=${f(took)} sorted=${f(sorted)} item_home=${homes} more=${more} overflow=${overflow} unsorted=${unsorted} back=${f(back)} cargo_left=${f(cargoLeft)} skipped=${f(skipped)} ms=${ms} stop=${String(stop).replace(/\s+/g, '_').slice(0, 40)}`.slice(0, 400)
}
