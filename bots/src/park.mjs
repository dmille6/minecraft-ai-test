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

// ================================================================================================================================
// GKHELPERS-01: THE PARK GATHER (owner 11-03 B: "close the park-materials gap"). LIVE showcase 11-03: the town's park was sited with
// every element skipped but a 4-cell meadow (no_flowers, no_sapling, no_bamboo, no_azalea, no_sugar_cane, no_leaves...): no town
// chest holds any of them and the ten bots' bags held 16 spruce saplings and 1 azalea. The crew now COLLECTS what the surroundings
// grow -- a flower, a tall flower's lower half, an azalea bush, the upper canes of sugar cane and bamboo (the root stays: it grows
// back), natural leaves only with shears in the bag -- banks it in a town chest with the saplings, azalea and bamboo its own bag
// spares, and the keeper adds the elements the town now holds to the park (terrace.mjs parkTopUp). PURE here.
// Never sweet berry bushes, cactus or vines (no list names them); never a crop, a sapling or anything in a reserved column.
// ================================================================================================================================
export const GATHER_CAP = Object.freeze({ flowers: 24, tall_flowers: 8, azalea: 8, bamboo: 9, cane: 6, hedge: 24, trees: 4 })
const SMALL_SET = new Set(SMALL_FLOWERS), TALL_SET = new Set(TALL_FLOWERS)
/** A world block the gather may take -> { el, item, keepBase?, lower?, shears? } | null. Pure. */
export function gatherKind (name) {
  const n = String(name ?? '').replace(/\[.*\]$/, '')
  if (SMALL_SET.has(n)) return { el: 'flowers', item: n }
  if (TALL_SET.has(n)) return { el: 'tall_flowers', item: n, lower: true }
  if (n === 'azalea' || n === 'flowering_azalea') return { el: 'azalea', item: n }
  if (n === 'sugar_cane') return { el: 'cane', item: 'sugar_cane', keepBase: true }
  if (n === 'bamboo') return { el: 'bamboo', item: 'bamboo', keepBase: true }
  if (HEDGE_ITEMS.includes(n)) return { el: 'hedge', item: n, shears: true }
  return null
}
export const GATHER_NAMES = Object.freeze([...SMALL_FLOWERS, ...TALL_FLOWERS, 'azalea', 'flowering_azalea', 'sugar_cane', 'bamboo', ...HEDGE_ITEMS])
/**
 * WHAT THE PARK STILL WANTS -> { element: n }. Pure. Every element the park's layout skipped for want of material (a `no_<x>`
 * reason: never no_room, no_quadrant, no_water, no_actuator) and every element it never placed, up to GATHER_CAP less what the
 * town and the crew's bags hold (`have`). Crops are not gathered (seeds come 1 in 8 off grass: named, never chased).
 */
export function parkWant (park, have = {}) {
  if (!park?.box) return {}
  const out = {}
  const placed = park.placed ?? {}
  for (const [el, cap] of Object.entries(GATHER_CAP)) {
    const why = String(park.skipped?.[el] ?? '')
    const wanted = (placed[el] ?? 0) === 0 && (/^no_/.test(why) && !/^no_(room|quadrant|water|actuator|natural_grass)$/.test(why))
    if (!wanted) continue
    const n = cap - haveOf(have, el)
    if (n > 0) out[el] = n
  }
  return out
}
/**
 * THE GATHER'S TARGETS -> [{ at, name, el, item, n }] nearest first, at most `max`, at most `want[el]` items an element. Pure.
 *   cands     [{ at: [x, y, z], name }] the world's candidate blocks (the bot's findBlocks over GATHER_NAMES)
 *   read      the world read (the root below a cane, a tall flower's lower half, the cells above a cut cane)
 *   reserved  (x, y, z) -> truthy: a protected zone, another project's record or box, the park itself, a farm, a road, a marker
 *   home, r   only within r columns of home (Chebyshev); from: the bot's feet (the order)
 *   shears    the bag holds shears (leaves only then: without them a leaf block drops no leaf block)
 * A cane or bamboo is taken at its SECOND block (the root stays and grows back); everything above it comes with it (n). A tall
 * flower only at its lower half (its upper half above it, the same name). A leaf block only a persistent=false one the ground
 * reaches (at most 3 above a solid block) -- never a log, never a leaf in a reserved column (a farm tree, a park tree).
 */
export function gatherTargets (cands, { read, reserved = () => null, home, r = 64, from = null, want = {}, max = 12, shears = false } = {}) {
  const left = { ...want }
  const nmOf = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
  const seen = new Set()
  const out = []
  const f = from ?? [home.x, home.y, home.z]
  const order = (cands ?? []).filter(c => Array.isArray(c?.at)).slice().sort((a, b) => (Math.abs(a.at[0] - f[0]) + Math.abs(a.at[1] - f[1]) + Math.abs(a.at[2] - f[2])) - (Math.abs(b.at[0] - f[0]) + Math.abs(b.at[1] - f[1]) + Math.abs(b.at[2] - f[2])) || a.at[0] - b.at[0] || a.at[2] - b.at[2] || a.at[1] - b.at[1])
  for (const c of order) {
    if (out.length >= max) break
    const [x, y0, z] = c.at
    if (Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) > r) continue
    const g = gatherKind(c.name)
    if (!g || !((left[g.el] ?? 0) > 0)) continue
    if (g.shears && !shears) continue
    let y = y0
    const here = nmOf(read(x, y, z))
    if (here !== nmOf({ name: c.name })) continue
    if (g.keepBase) {
      // walk down to the root; take the block above it (none: a single cane is a root, left)
      let b = y
      while (nmOf(read(x, b - 1, z)) === here) b--
      y = b + 1
      if (nmOf(read(x, y, z)) !== here) continue
    } else if (g.lower) {
      if (nmOf(read(x, y - 1, z)) === here) y--
      if (!SOIL_RE.test(nmOf(read(x, y - 1, z)))) continue
    } else if (g.shears) {
      const b = read(x, y, z)
      if (b?.getProperties?.()?.persistent === true || b?.persistent === true) continue
      let ground = false
      for (let d = 1; d <= 3 && !ground; d++) { const u = read(x, y - d, z); if (u && u.boundingBox === 'block' && !/leaves$|_log$|_wood$/.test(nmOf(u))) ground = true }
      if (!ground) continue
    } else if (!SOIL_RE.test(nmOf(read(x, y - 1, z))) && !(g.el === 'azalea' && /^(moss_block|clay|rooted_dirt)$/.test(nmOf(read(x, y - 1, z))))) continue
    const k = `${x},${y},${z}`
    if (seen.has(k)) continue
    // the whole column the dig touches (a cane's canes above it) must be free of every reservation
    let n = 1
    if (g.keepBase) while (nmOf(read(x, y + n, z)) === here) n++
    if (g.lower) n = 1
    let bad = false
    for (let d = 0; d < Math.max(n, g.lower ? 2 : 1) && !bad; d++) if (reserved(x, y + d, z)) bad = true
    if (bad) continue
    seen.add(k)
    left[g.el] -= n
    out.push({ at: [x, y, z], name: here, el: g.el, item: g.item, n })
  }
  return out
}
/** Every item a park element plants (and the hoe's family) -> Set. */
export const PARK_ITEMS = new Set(Object.values(ELEMENT_ITEMS).flat())
/** A bag's park plants -> { name: n } (the crew's pantry). Pure. */
export const parkItemsOf = held => Object.fromEntries(Object.entries(held ?? {}).filter(([n, v]) => PARK_ITEMS.has(n) && Number(v) > 0))
/** The crew's pantries summed -> { name: n }: only a FRESH pantry (written within `fresh` ms) of a bot `live(holder)` (it holds a
 *  crew lease now), never `me`'s (the caller adds its own bag). Pure. */
export function pantrySum (pantry, { now = Date.now(), fresh = 12 * 60_000, live = () => true, me = null } = {}) {
  const out = {}
  for (const [h, p] of Object.entries(pantry ?? {})) {
    if (h === me || !live(h) || !(now - (Number(p?.at) || 0) <= fresh)) continue
    for (const [n, v] of Object.entries(p.items ?? {})) if (PARK_ITEMS.has(n) && Number(v) > 0) out[n] = (out[n] ?? 0) + Number(v)
  }
  return out
}
/**
 * A PARK CELL ANOTHER CREW BOT CAN PLANT -> the cells | []. Pure. An open planting (not done, not prev) whose element THIS visit
 * passed for want of material (`skip(cell)` === 'no_<element>') while a live crew pantry (`others`, pantrySum) holds that element:
 * the keeper never completes the stage over it (the helper carrying it plants it at its next visit).
 */
export function parkHeldByCrew (rec, { done = () => false, skip = () => null, others = {} } = {}) {
  return (rec?.cells ?? []).filter(c => !c.prev && PARK_PLACE_ROLES.has(c.role) && !done(c) && /^no_/.test(String(skip(c) ?? '')) && haveOf(others, elementOf(c.role)) > 0)
}
/**
 * WHERE THE GATHERER STANDS FOR A TARGET -> [x, y, z] (the feet) | null. Pure. A flower or a tall flower's lower half: in its own
 * cell (no collision; it drops at the feet). An azalea bush, a cane or bamboo (taken above its root), a leaf block: a neighbour
 * column's cell at the target's ground (the root's height; a leaf block up to 3 above) with a solid block under it and two of air.
 */
export function gatherStand (read, t) {
  const nmOf = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
  const open = b => !!b && (AIRN(nmOf(b)) || replaceableCell(b)) && !isLiquid(b)
  const solid = b => !!b && b.boundingBox === 'block' && !isLiquid(b)
  const [x, y, z] = t.at
  if (t.el === 'flowers' || t.el === 'tall_flowers') return solid(read(x, y - 1, z)) ? [x, y, z] : null
  const ys = t.el === 'hedge' ? [y, y - 1, y - 2, y - 3] : (t.el === 'cane' || t.el === 'bamboo') ? [y - 1] : [y]
  for (const sy of ys) for (const [dx, dz] of N4) {
    const sx = x + dx, sz = z + dz
    if (solid(read(sx, sy - 1, sz)) && open(read(sx, sy, sz)) && open(read(sx, sy + 1, sz))) return [sx, sy, sz]
  }
  return null
}
