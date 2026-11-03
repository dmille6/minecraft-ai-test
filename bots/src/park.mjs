// TOWNTERRACE-01: THE PARK/GARDEN'S PLANTS AND THE VISIT'S SKIP RULE (owner 11-03, ledger townterrace-1103). PURE: the plant lists,
// the park's palette roles (tidy.mjs TIDY_PALETTE carries them), the rule the groundskeeper's visit uses to pass over a park cell it
// cannot work now (skills.mjs buildTidy `alsoDone`), and the park's bill. Kept in its own module (no import of tidy.mjs) so tidy.mjs,
// terrace.mjs and buildrun.mjs can all read it without an import cycle.
//
// NEVER sweet berry bushes, cactus or vines: no list here names them (owner 11-03).

import { isLiquid, replaceableCell } from './townplan.mjs'

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const AIRN = n => n === 'air' || n === 'cave_air' || n === 'void_air'
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]

export const SMALL_FLOWERS = Object.freeze(['poppy', 'dandelion', 'cornflower', 'oxeye_daisy', 'azure_bluet', 'allium', 'blue_orchid', 'lily_of_the_valley', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip'])
export const TALL_FLOWERS = Object.freeze(['rose_bush', 'lilac', 'peony', 'sunflower'])
export const PARK_SAPLINGS = Object.freeze(['oak_sapling', 'birch_sapling', 'cherry_sapling', 'spruce_sapling', 'acacia_sapling', 'jungle_sapling'])
export const CROP_ITEMS = Object.freeze(['wheat_seeds', 'carrot', 'potato', 'beetroot_seeds', 'pumpkin_seeds', 'melon_seeds'])
export const HEDGE_ITEMS = Object.freeze(['oak_leaves', 'birch_leaves', 'spruce_leaves', 'azalea_leaves', 'flowering_azalea_leaves', 'cherry_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves'])
const rot = (list, i) => list.slice(i % list.length).concat(list.slice(0, i % list.length))
/**
 * THE PARK'S ROLES: rotated item lists, so neighbouring cells take different kinds from one bag (buildrun.mjs blockFor takes a role's
 * first held item; cellDone accepts any of them). `till` and `meadow` are tool USES (buildrun.mjs `useFor`), never placed: their
 * lists name the block a use leaves (farmland) or one no bag holds (short_grass), so a placement never runs on them.
 */
export const PARK_PALETTE = Object.freeze({
  flower0: rot(SMALL_FLOWERS, 0), flower1: rot(SMALL_FLOWERS, 3), flower2: rot(SMALL_FLOWERS, 6), flower3: rot(SMALL_FLOWERS, 9),
  tall0: rot(TALL_FLOWERS, 0), tall1: rot(TALL_FLOWERS, 2),
  shrub: ['flowering_azalea', 'azalea'],
  sapling0: rot(PARK_SAPLINGS, 0), sapling1: rot(PARK_SAPLINGS, 1), sapling2: rot(PARK_SAPLINGS, 2),
  bamboo: ['bamboo'],
  crop0: rot(CROP_ITEMS, 0), crop1: rot(CROP_ITEMS, 1), crop2: rot(CROP_ITEMS, 2), crop3: rot(CROP_ITEMS, 3),
  cane: ['sugar_cane'],
  hedge: [...HEDGE_ITEMS],
  till: ['farmland'],
  meadow: ['short_grass'],
})
export const PARK_USE_ROLES = new Set(['till', 'meadow'])
export const PARK_PLACE_ROLES = new Set(Object.keys(PARK_PALETTE).filter(r => !PARK_USE_ROLES.has(r)))
export const PARK_ROLES = new Set(Object.keys(PARK_PALETTE))
/** The roles a builder walks through once placed (no collision): never an obstacle to a visit's walk (buildrun.mjs `openRole`). */
export const OPEN_ROLES = new Set(['light', ...Object.keys(PARK_PALETTE).filter(r => /^(flower|tall|sapling|crop)/.test(r)), 'cane', 'till', 'meadow'])
/** A park role's element (the skip names). Pure. */
export const elementOf = role => (/^flower/.test(role) ? 'flowers' : /^tall/.test(role) ? 'tall_flowers' : role === 'shrub' ? 'azalea' : /^sapling/.test(role) ? 'trees' : /^crop/.test(role) || role === 'till' ? 'crops' : String(role))
/** What a park element needs -> [item names, any one]. */
export const ELEMENT_ITEMS = Object.freeze({ flowers: SMALL_FLOWERS, tall_flowers: TALL_FLOWERS, azalea: ['azalea', 'flowering_azalea'], trees: PARK_SAPLINGS, bamboo: ['bamboo'], crops: CROP_ITEMS, cane: ['sugar_cane'], hedge: HEDGE_ITEMS, meadow: ['bone_meal'] })
export const HOE_RE = /_hoe$/
/** How many the town can get of an element (`have` {name: n}: the town's stock plus the keeper's bag). Pure. */
export const haveOf = (have, el) => (ELEMENT_ITEMS[el] ?? []).reduce((s, n) => s + (Number(have?.[n]) || 0), 0)
export const hasHoe = have => Object.entries(have ?? {}).some(([n, v]) => HOE_RE.test(n) && Number(v) > 0)
/** A planted block against the item that plants it: a crop block is its seed, a bamboo shoot its bamboo (buildrun.mjs blockFamily). */
export const PLANTED_AS = Object.freeze({ wheat: 'wheat_seeds', carrots: 'carrot', potatoes: 'potato', beetroots: 'beetroot_seeds', pumpkin_stem: 'pumpkin_seeds', attached_pumpkin_stem: 'pumpkin_seeds', melon_stem: 'melon_seeds', attached_melon_stem: 'melon_seeds', bamboo_sapling: 'bamboo' })
export const plantedAs = n => PLANTED_AS[n] ?? n
/** The block a hoe tills (vanilla HoeItem: grass, dirt and a dirt path become farmland with air above; coarse dirt only dirt). */
export const TILL_RE = /^(grass_block|dirt|dirt_path)$/
export const SOIL_RE = /^(grass_block|dirt|podzol|coarse_dirt|rooted_dirt|moss_block|mycelium|mud)$/
const CANE_SOIL = /^(grass_block|dirt|sand|red_sand|podzol|coarse_dirt|mud|moss_block|rooted_dirt)$/
const GROWN = /^(short_grass|tall_grass|fern|large_fern)$|flower|tulip|poppy|dandelion|orchid|allium|bluet|daisy|lily_of_the_valley|rose_bush|lilac|peony/
const isWater = b => !!b && nm(b) === 'water'

/**
 * A TERRACE CELL THE VISIT PASSES OVER NOW -> a reason | null (buildrun.mjs `alsoDone`: a passed cell reads done for this visit,
 * so nothing waits on it and the stage can complete over it -- an element the town cannot make is skipped, never a blocker). Pure.
 *   SEAL   (role core with an `opener`): the cut that exposes it still stands -- placed after it ('opener_standing')
 *   PLANT  no palette item in the bag ('no_<element>'), a solid block in the cell ('occupied'), the support below is not what the
 *          plant stands on ('no_support': soil; farmland for a crop; soil beside water for cane, else 'no_water'), no room above a
 *          tall flower ('no_room')
 *   USE    the tool is not in the bag ('no_hoe' / 'no_bone_meal'), the cell is not the block the tool converts ('not_soil' /
 *          'not_grass'), the block above is not air ('covered'); a meadow cell reads done once a plant stands on it ('grown')
 * A cell already done (its block is the role's) is never passed (null): the caller's own done test answers it.
 *   has(name)  the bag holds one; tools { hoe, boneMeal } held now
 */
export function terraceSkip (c, read, { has = () => false, tools = {}, palette = PARK_PALETTE } = {}) {
  if (!c) return null
  if (c.role === 'core' && Array.isArray(c.opener)) { const b = read(...c.opener); return !b || !(AIRN(nm(b)) || replaceableCell(b)) ? 'opener_standing' : null }
  const at = c.at
  if (PARK_USE_ROLES.has(c.role)) {
    const b = read(...at), up = read(at[0], at[1] + 1, at[2])
    if (!b) return 'unread'
    if (c.role === 'meadow') {
      if (up && GROWN.test(nm(up))) return 'grown'
      if (!tools.boneMeal) return 'no_bone_meal'
      if (nm(b) !== 'grass_block') return 'not_grass'
    } else {
      if (nm(b) === 'farmland') return null
      if (!tools.hoe) return 'no_hoe'
      if (!TILL_RE.test(nm(b))) return 'not_soil'
    }
    if (!up || !AIRN(nm(up))) return 'covered'
    return null
  }
  if (!PARK_PLACE_ROLES.has(c.role)) return null
  const list = palette[c.role] ?? []
  const b = read(...at)
  if (b && list.some(p => plantedAs(nm(b)) === plantedAs(p))) return null
  if (!list.some(n => has(n))) return `no_${elementOf(c.role)}`
  if (!b || !(AIRN(nm(b)) || replaceableCell(b))) return 'occupied'
  const s = read(at[0], at[1] - 1, at[2]), sn = nm(s)
  if (/^crop/.test(c.role)) return sn === 'farmland' ? null : 'no_support'
  if (c.role === 'cane') {
    if (!CANE_SOIL.test(sn)) return 'no_support'
    return N4.some(([dx, dz]) => isWater(read(at[0] + dx, at[1] - 1, at[2] + dz))) ? null : 'no_water'
  }
  if (c.role === 'hedge') return s && s.boundingBox === 'block' && !isLiquid(s) ? null : 'no_support'
  if (!SOIL_RE.test(sn) && !(c.role === 'bamboo' && /^(sand|red_sand|gravel)$/.test(sn))) return 'no_support'
  if (/^tall/.test(c.role)) { const u = read(at[0], at[1] + 1, at[2]); if (!u || !(AIRN(nm(u)) || replaceableCell(u))) return 'no_room' }
  return null
}

/**
 * THE PARK'S BILL -> { item: n } drawn from town (skills.mjs needFromTown). Pure. For each open planting cell its first palette item
 * the town or the bag holds, counted, less the bag's; one hoe when a till cell is open and the bag holds none; bone meal for the open
 * meadow cells, less the bag's. `done(cell)`: the visit's done test (a done or waived cell owes nothing).
 */
export function parkBill (rec, read, { held = {}, stock = {}, done = () => false } = {}) {
  const want = {}
  let till = 0, meadow = 0
  for (const c of rec?.cells ?? []) {
    if (!PARK_ROLES.has(c.role) || done(c)) continue
    if (c.role === 'till') { if (nm(read(...c.at)) !== 'farmland') till++; continue }
    if (c.role === 'meadow') { const up = read(c.at[0], c.at[1] + 1, c.at[2]); if (!(up && GROWN.test(nm(up)))) meadow++; continue }
    const b = read(...c.at)
    if (b && (PARK_PALETTE[c.role] ?? []).some(p => plantedAs(nm(b)) === plantedAs(p))) continue
    const n = (PARK_PALETTE[c.role] ?? []).find(p => (Number(stock[p]) || 0) + (Number(held[p]) || 0) > 0)
    if (n) want[n] = (want[n] ?? 0) + 1
  }
  const out = {}
  for (const [n, v] of Object.entries(want)) { const h = Number(held[n]) || 0; if (v > h && (Number(stock[n]) || 0) > 0) out[n] = Math.min(v - h, Number(stock[n])) }
  if (till && !hasHoe(held)) { const hoe = Object.keys(stock).filter(n => HOE_RE.test(n) && Number(stock[n]) > 0).sort()[0]; if (hoe) out[hoe] = 1 }
  const bm = Number(held.bone_meal) || 0
  if (meadow > bm && (Number(stock.bone_meal) || 0) > 0) out.bone_meal = Math.min(meadow - bm, Number(stock.bone_meal))
  return out
}
