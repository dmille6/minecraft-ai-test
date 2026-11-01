// CRAFT PLAN: the whole tree, every variant, the station -- decided before anything is crafted.
//
// WHY. The craft resolver made each missing ingredient for its parent alone and lived on the old over-crafting
// (bot.craft was handed the ITEM count as the CRAFT count) for slack. With exact counts (craftsync) `craft
// wooden_pickaxe` from logs alone failed 6/6 on the sandbox: planks +4, sticks -2, planks +4, table -4, retry ->
// MAX_CRAFT_DEPTH. A first planner (db359f2) summed demand but, run against the real 1.21.8 recipes, both
// reviews broke it five ways; each is a rule below.
//
//   1. ROOT DEMAND. craft(count) means `count` MORE of the item. Held copies of the ROOT are never subtracted
//      (a bot holding one wooden_pickaxe that asks for one gets a second); prerequisites are drawn from the bag.
//   2. VARIANTS BY QUANTITY. Real recipes come one per wood type (12 wooden_pickaxe variants, 13 stick, 12
//      crafting_table), each taking ONE plank type. Variants are ranked by how many crafts the bot can actually
//      draw from what it holds (or can make from it), then simulated; a variant that cannot finish is abandoned
//      for the next, and a step may be split across variants (2 oak logs + 1 birch log make a wooden_pickaxe:
//      oak for the table and the head, birch for the sticks). The CHOSEN recipe objects are returned, and the
//      caller crafts with exactly those -- nothing re-chooses during execution.
//   3/4. STATION + BATCH. The full requested quantity and the crafting_table (when a chosen recipe needs one and
//      none is ready) are planned together, all or nothing, BEFORE the caller crafts anything. 4 planks + 2
//      sticks with no table and no logs is refused up front, naming the log -- not spent on a table first.
//   5. CYCLES + LIMITS. A recipe whose ingredient is an item still being planned above it is dropped
//      (iron_ingot <-> iron_block, iron_ingot <-> iron_nugget). Running out of the node budget fails the plan.
//      Either way the plan reports its shortfall explicitly ("2x iron_ingot") and crafts nothing.
//
// Pure: the caller supplies inventory and recipes as shapes { yield, table, ingredients: [{ name, count }],
// ref } (ref = the caller's own recipe object, handed back in the steps). Nothing here touches a bot.

/**
 * Plan `count` MORE of `item`.
 *   recipesOf(name) -> shapes          every recipe for an item (any order; ties keep it)
 *   have            -> { name: count } what the bot holds
 *   tableReady      -> a crafting table is within reach, or carried
 *   prefer(shape)   -> tie-break score (higher first), e.g. the canonical wood
 * Returns { ok, steps: [{ item, crafts, recipe }], needsStation, shortfall: [{ item, count }], limit }.
 * steps are in execution order, the root last; `recipe` is the chosen shape (its .ref is the caller's object).
 */
export function planCraft ({ item, count = 1, recipesOf, have = {}, tableReady = false, prefer = () => 0, maxNodes = 400 }) {
  const cache = new Map()
  const shapes = n => {
    if (!cache.has(n)) cache.set(n, (recipesOf(n) ?? []).filter(r => r?.ingredients?.length))
    return cache.get(n)
  }
  const usable = (name, anc) => shapes(name).filter(r => !r.ingredients.some(i => anc.has(i.name)))

  // How many of `name` could the bot end up with from `inv`? Held, plus the best one variant makes. An estimate
  // for RANKING only -- it ignores competition between consumers; the simulation below is what decides.
  const supply = (inv, name, anc, depth = 0) => {
    const held = inv[name] ?? 0
    if (depth >= 3) return held
    const a2 = new Set(anc).add(name)
    let best = 0
    for (const r of usable(name, a2)) {
      const crafts = Math.min(...r.ingredients.map(i => Math.floor(supply(inv, i.name, a2, depth + 1) / i.count)))
      if (crafts > 0) best = Math.max(best, crafts * r.yield)
    }
    return held + best
  }
  const rank = (inv, name, anc) => {
    const a2 = new Set(anc).add(name)
    return usable(name, a2)
      .map((r, i) => ({ r, i, cap: Math.min(...r.ingredients.map(x => Math.floor(supply(inv, x.name, a2) / x.count))), pref: prefer(r) }))
      .sort((a, b) => b.cap - a.cap || b.pref - a.pref || (a.r.table ? 1 : 0) - (b.r.table ? 1 : 0) || a.i - b.i)
  }

  let nodes = 0, limit = false
  const clone = s => ({ inv: { ...s.inv }, steps: [...s.steps], station: s.station })

  // Take n of `name` from the bag, crafting what is missing. A new state, or null.
  function obtain (s, name, n, anc) {
    const take = Math.min(s.inv[name] ?? 0, n)
    const t = take ? clone(s) : s
    if (take) t.inv[name] -= take
    return n - take > 0 ? make(t, name, n - take, anc) : t
  }
  function station (s, anc) {
    if (tableReady || s.station) return s
    const t = obtain(s, 'crafting_table', 1, anc)        // consumed: it is put down
    if (!t) return null
    const u = clone(t); u.station = true
    return u
  }
  // Craft at least n of `name` (for a consumer or the root). The caller takes what it needs; extra stays.
  function make (s, name, n, anc) {
    if (++nodes > maxNodes) { limit = true; return null }
    const a2 = new Set(anc).add(name)
    let st = s, rem = n
    while (rem > 0) {
      let next = null
      for (const c of rank(st.inv, name, anc).filter(c => c.cap > 0)) {
        for (let m = Math.min(Math.ceil(rem / c.r.yield), c.cap); m >= 1 && !next; m--) {
          let t = c.r.table ? station(st, a2) : st
          for (const ing of c.r.ingredients) { if (t) t = obtain(t, ing.name, ing.count * m, a2) }
          if (limit) return null
          if (!t) continue
          t = clone(t)
          t.steps.push({ item: name, crafts: m, recipe: c.r })
          const made = m * c.r.yield
          t.inv[name] = (t.inv[name] ?? 0) + made - Math.min(made, rem)
          next = { t, made }
        }
        if (next) break
      }
      if (!next) return null
      st = next.t
      rem -= Math.min(next.made, rem)
    }
    return st
  }

  const done = make({ inv: { ...have }, steps: [], station: false }, item, Number(count) || 1, new Set())
  if (done) return { ok: true, steps: mergeSteps(done.steps), needsStation: done.station || done.steps.some(x => x.recipe.table), shortfall: [], limit: false }
  return { ok: false, steps: [], needsStation: false, shortfall: shortfallOf(), limit }

  // THE HONEST SHORTFALL: walk the best-ranked plausible variants, drawing on the bag, and record what cannot be
  // had. An item is PLAUSIBLE when nothing crafts it (gather it) or some acyclic variant has all-plausible
  // ingredients; an implausible item is reported as itself (2x iron_ingot, never 27 nuggets or an iron_block).
  function shortfallOf () {
    const out = new Map()
    const inv = { ...have }
    const memo = new Map()
    const plausible = (name, anc, depth = 0) => {
      if (!shapes(name).length) return true
      if (depth > 6) return false
      const key = `${name}|${[...anc].sort().join()}`
      if (memo.has(key)) return memo.get(key)
      memo.set(key, false)
      const a2 = new Set(anc).add(name)
      const ok = usable(name, a2).some(r => r.ingredients.every(i => plausible(i.name, a2, depth + 1)))
      memo.set(key, ok)
      return ok
    }
    let stationDone = tableReady
    const need = (name, n, anc, root = false) => {
      const take = root ? 0 : Math.min(inv[name] ?? 0, n)
      inv[name] = (inv[name] ?? 0) - take
      const rest = n - take
      if (rest <= 0) return
      const a2 = new Set(anc).add(name)
      // The ROOT opens with its best-ranked variant, whatever its ingredients are (a torch asks for coal -- mined
      // -- not charcoal, though only charcoal has no recipe at all). Below it, plausibility decides whether to
      // descend into an item or report it as itself.
      const ranked = shapes(name).length ? rank(inv, name, anc) : []
      const pick = root ? ranked[0] : ranked.find(c => c.r.ingredients.every(i => plausible(i.name, a2)))
      if (!pick) { out.set(name, (out.get(name) ?? 0) + rest); return }
      if (pick.r.table && !stationDone) { stationDone = true; need('crafting_table', 1, a2) }
      const crafts = Math.ceil(rest / pick.r.yield)
      for (const ing of pick.r.ingredients) need(ing.name, ing.count * crafts, a2)
      inv[name] = (inv[name] ?? 0) + crafts * pick.r.yield - rest
    }
    need(item, Number(count) || 1, new Set(), true)
    if (!out.size && limit) out.set(item, Number(count) || 1)
    return [...out].map(([i, c]) => ({ item: i, count: c }))
  }
}

/**
 * One craft call per recipe where it is safe: a later step with the SAME recipe joins an earlier one when no step
 * in between produces any of its ingredients (so its inputs were already there). Each bot.craft call costs a
 * verification round trip; three single plank crafts become one. Order is otherwise kept. Pure.
 */
export function mergeSteps (steps) {
  const out = []
  for (const st of steps) {
    let into = -1
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].recipe === st.recipe) { into = i; break }
      if (st.recipe.ingredients.some(g => g.name === out[i].item)) break
    }
    if (into >= 0) out[into] = { ...out[into], crafts: out[into].crafts + st.crafts }
    else out.push({ ...st })
  }
  return out
}
