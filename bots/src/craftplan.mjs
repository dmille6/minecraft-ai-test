// CRAFT PLAN: how many of each intermediate to craft for the WHOLE remaining tree, in one go.
//
// WHY. The craft resolver made each missing ingredient for its parent alone ("3x oak_planks" -> one plank craft)
// and relied on the old over-crafting -- bot.craft was handed the ITEM count as the CRAFT count, so 3 planks
// made 12 -- for slack. With exact counts (craftsync, c5c2dc5) `craft wooden_pickaxe` from logs alone failed 6/6
// on the sandbox: planks +4, sticks -2, planks +4, crafting_table -4, retry pickaxe with 2 planks ->
// MAX_CRAFT_DEPTH. The sticks and the table were drawing on the same planks the pickaxe needed.
//
// So demand is summed over every consumer (the parent, its other ingredients, and the crafting_table when the
// parent needs one and none is in reach or carried), and each item is crafted once, producers first.
// Pure: the caller supplies inventory and recipes; nothing here touches a bot.

/** A recipe as the planner sees it: { yield, table, ingredients: [{ name, count }] } (counts per ONE craft). */

/**
 * Pick the recipe to plan with among `candidates` (shapes as above). A recipe is VIABLE when each ingredient is
 * held, or is made by some recipe whose ingredients are all held (one level). Viable beats not; among viable,
 * more ingredients held directly wins; then no-table beats table; then the caller's order. Pure.
 */
export function chooseRecipe (candidates, have, recipesOf) {
  const held = n => (have[n] ?? 0) > 0
  const oneLevel = n => (recipesOf(n) ?? []).some(r => r.ingredients.length && r.ingredients.every(i => held(i.name)))
  const greater = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] > b[k]; return false }
  let best = null, bestKey = null
  for (const [i, r] of (candidates ?? []).entries()) {
    if (!r?.ingredients?.length) continue
    const viable = r.ingredients.every(x => held(x.name) || oneLevel(x.name))
    const key = [viable ? 1 : 0, r.ingredients.filter(x => held(x.name)).length, r.table ? 0 : 1, -i]
    if (!bestKey || greater(key, bestKey)) { best = r; bestKey = key }
  }
  return best
}

/**
 * The recipe the planner may expand `name` with, or null (treat it as raw: gather it). A viable recipe
 * (chooseRecipe) if there is one; otherwise one whose ingredients are all uncraftable, so the shortfall is named
 * at the material to gather ("oak_log", not "oak_planks"); otherwise null -- an iron_ingot nobody can make from
 * nuggets or blocks here is reported as an iron_ingot, not as 27 nuggets. Pure.
 */
export function planRecipe (candidates, have, recipesOf) {
  const held = n => (have[n] ?? 0) > 0
  const oneLevel = n => (recipesOf(n) ?? []).some(r => r.ingredients.length && r.ingredients.every(i => held(i.name)))
  const r = chooseRecipe(candidates, have, recipesOf)
  if (r && r.ingredients.every(x => held(x.name) || oneLevel(x.name))) return r
  return (candidates ?? []).find(c => c?.ingredients?.length && c.ingredients.every(i => !(recipesOf(i.name) ?? []).length)) ?? null
}

/**
 * Plan `count` of `item` (ITEMS, not crafts). `rootRecipe` is the parent's chosen recipe; `recipeOf(name)` gives
 * the recipe to use for an intermediate (null = not craftable from here: a raw shortfall). `tableReady`: a table
 * is in reach or carried. Returns:
 *   steps:      [{ item, crafts, yield }]  the intermediates, producers first, each item once (root excluded)
 *   rootCrafts: crafts of the root itself
 *   raw:        [{ item, count }]          what must be gathered; when non-empty nothing should be crafted
 * Bounded: at most maxNodes distinct items. Pure.
 */
export function planCraftTree ({ item, count = 1, rootRecipe, recipeOf, have = {}, tableReady = false, maxNodes = 16 }) {
  const recipes = new Map([[item, rootRecipe]])
  const order = []                                      // post-order: producers before consumers
  const seen = new Set()
  const visit = (name) => {
    if (seen.has(name) || seen.size >= maxNodes) return
    seen.add(name)
    const r = recipes.has(name) ? recipes.get(name) : recipeOf(name)
    recipes.set(name, r ?? null)
    for (const i of r?.ingredients ?? []) visit(i.name)
    order.push(name)
  }
  const needsTable = !!rootRecipe?.table && !tableReady && !((have.crafting_table ?? 0) > 0)
  visit(item)
  if (needsTable) visit('crafting_table')

  const demand = { [item]: Number(count) || 1 }
  if (needsTable) demand.crafting_table = (demand.crafting_table ?? 0) + 1
  const crafts = {}
  const raw = []
  for (const name of [...order].reverse()) {             // consumers before producers: every demand is in
    const short = Math.max(0, (demand[name] ?? 0) - (have[name] ?? 0))
    if (!short) continue
    const r = recipes.get(name)
    if (!r) { raw.push({ item: name, count: short }); continue }
    const n = Math.ceil(short / Math.max(1, r.yield || 1))
    crafts[name] = n
    for (const ing of r.ingredients) demand[ing.name] = (demand[ing.name] ?? 0) + ing.count * n
  }
  const steps = order.filter(n => n !== item && crafts[n]).map(n => ({ item: n, crafts: crafts[n], yield: recipes.get(n).yield || 1 }))
  return { steps, rootCrafts: crafts[item] ?? 0, raw, needsTable }
}
