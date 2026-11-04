// ANVILAPPLY-01 + ENCHANT-01 (OWNER 11-04: "build the skills bots need to USE the anvil and enchanting table"; ledger
// anvilbooks-1103). The method is the sandbox proof docs/reports/anvilproof-2026-11-03.md (Paper 1.21.8, mineflayer 4.37.1):
//
//   ANVIL. mineflayer's anvil.combine / anvil.rename are NEVER called: they price the job with prismarine-item 1.18's
//   Item.anvil, which reads no `stored_enchantments`, so every enchanted book is "Not anvil-able". The window is driven by
//   hand: the tool into slot 0, the book into slot 1 (plain left clicks on WINDOW slot numbers), the server's result appears
//   in slot 2 (~0.3 s) and its level cost arrives as window property 0; the result is shift-clicked out ONLY when
//   level >= cost and cost < 40 (survival "Too Expensive"). The server refuses an unaffordable take anyway (proof A4);
//   this side never tries one.
//   TABLE. putTargetItem / putLapis take WINDOW-numbered items (table.items(); a bot.inventory item's slot clicks the wrong
//   cell or asserts "invalid operation"), and mineflayer's 'ready' fires on the zero properties sent at open, before the
//   server prices the item: the offers are waited for (a level > 0, then OFFER_SETTLE_MS for the other two).
//
// Everything that decides is a pure function here (tested in bots/test/enchant.test.mjs); the two window drivers take the
// bot and return what the SERVER answered (its slot updates, its experience packet). skills.mjs runs them as the
// `anvil_apply` and `enchant_tool` skills, which shop.mjs buildOrder asks for at town.
//
// KILL SWITCHES: ANVILAPPLY=off, ENCHANTTOOL=off (never asked).

const sw = v => !['off', '0', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
const env = typeof process !== 'undefined' ? process.env : {}
export const ANVILAPPLY = Object.freeze({ on: sw(env.ANVILAPPLY) })
export const ENCHANTTOOL = Object.freeze({ on: sw(env.ENCHANTTOOL) })

/** Survival refuses an anvil job at this cost or above ("Too Expensive"). */
export const TOO_EXPENSIVE = 40
/** How far from the bot an anvil / table may be for the ask (the skill walks to it). */
export const STATION_FIND = 32
/** The skill's reach to the block before it opens it. */
export const STATION_REACH = 3
/** Per bot: one anvil ask and one table ask at most this often (an issue or a skip). */
export const ASK_EVERY_MS = 20 * 60_000
/** A town book withdrawn and found useless for this bag: no more town books for this long. */
export const BOOK_MISS_MS = 6 * 60 * 60_000
/** The table is used only from this level: a no-bookshelf table's top offer is at most 8 levels (proof: 1/5/8). */
export const TABLE_MIN_LEVEL = 8
/** The lapis a bag takes from town for the table (one enchant costs 1-3). */
export const LAPIS_TAKE = 6
/** Waits (the proof: result ~0.3 s; offers ~0.1 s apart). */
export const RESULT_WAIT_MS = 5_000
export const OFFER_WAIT_MS = 8_000
export const OFFER_SETTLE_MS = 800
export const OPEN_WAIT_MS = 10_000

export const ANVIL_BLOCKS = Object.freeze(['anvil', 'chipped_anvil', 'damaged_anvil'])
export const TABLE_BLOCK = 'enchanting_table'

// ---- items ----------------------------------------------------------------------------------------------------------
const TOOL_RE = /^(netherite|diamond|iron|stone|golden|wooden)_(pickaxe|axe|shovel|hoe|sword)$/
/** Kinds in the owner's order: the pickaxe first. */
export const KIND_ORDER = Object.freeze(['pickaxe', 'axe', 'shovel', 'sword', 'hoe'])
export const TIER_ORDER = Object.freeze(['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'])
/** -> { tier, kind } | null. Pure. */
export function toolOf (name) {
  const m = TOOL_RE.exec(String(name ?? ''))
  return m ? { tier: m[1], kind: m[2] } : null
}
/** The enchantments each tool kind takes from a book here (vanilla 1.21 supported items; curses never). */
const MINING = ['efficiency', 'fortune', 'silk_touch', 'unbreaking', 'mending']
export const APPLIES = Object.freeze({
  pickaxe: Object.freeze([...MINING]),
  shovel: Object.freeze([...MINING]),
  hoe: Object.freeze([...MINING]),
  axe: Object.freeze([...MINING, 'sharpness', 'smite', 'bane_of_arthropods']),
  sword: Object.freeze(['sharpness', 'smite', 'bane_of_arthropods', 'looting', 'knockback', 'fire_aspect', 'sweeping_edge', 'unbreaking', 'mending']),
})
/** Mutually exclusive sets (vanilla). */
export const EXCLUSIVE = Object.freeze([['fortune', 'silk_touch'], ['sharpness', 'smite', 'bane_of_arthropods']])
/** Book order (owner 11-04: Mending / Unbreaking / Efficiency first). */
export const BOOK_ORDER = Object.freeze(['mending', 'unbreaking', 'efficiency', 'fortune', 'silk_touch', 'sharpness', 'looting', 'smite', 'bane_of_arthropods', 'sweeping_edge', 'knockback', 'fire_aspect'])
/** Vanilla 1.21 max levels and anvil (item) costs; a BOOK costs half (at least 1) per level. Proof: Mending book 2, Unbreaking III 3. */
export const ENCH_INFO = Object.freeze({
  mending: { max: 1, cost: 4 }, unbreaking: { max: 3, cost: 2 }, efficiency: { max: 5, cost: 1 }, fortune: { max: 3, cost: 4 },
  silk_touch: { max: 1, cost: 8 }, sharpness: { max: 5, cost: 1 }, smite: { max: 5, cost: 2 }, bane_of_arthropods: { max: 5, cost: 2 },
  looting: { max: 3, cost: 4 }, knockback: { max: 2, cost: 2 }, fire_aspect: { max: 2, cost: 4 }, sweeping_edge: { max: 3, cost: 4 },
})

/**
 * THE ENCHANTMENTS ON AN ITEM -> [{ name, level }]. Pure given a registry (`registry.enchantments[id].name`). 1.20.5+ items
 * carry them as components: `enchantments` on a tool, `stored_enchantments` on a book ({ enchantments: [{ id, level }] }, as
 * mineflayer 4.37 builds them on Paper 1.21.8); a plain `{ name, lvl }` list (prismarine-item's enchants) is read too.
 */
export function enchantsOf (item, registry = null, { stored = item?.name === 'enchanted_book' } = {}) {
  if (!item) return []
  const comp = item.componentMap?.get?.(stored ? 'stored_enchantments' : 'enchantments')?.data
  const list = Array.isArray(comp?.enchantments) ? comp.enchantments : Array.isArray(comp) ? comp : null
  const nameOf = e => (typeof e?.name === 'string' ? e.name.replace(/^minecraft:/, '') : registry?.enchantments?.[e?.id]?.name ?? null)
  if (list) return list.map(e => ({ name: nameOf(e), level: Number(e?.level ?? e?.lvl) || 1 })).filter(e => e.name)
  if (Array.isArray(item.enchants) && item.enchants.length) return item.enchants.map(e => ({ name: nameOf(e), level: Number(e?.lvl ?? e?.level) || 1 })).filter(e => e.name)
  return []
}
/** The prior-work penalty an item carries (`repair_cost`). Pure. */
export const repairCostOf = item => Math.max(0, Number(item?.componentMap?.get?.('repair_cost')?.data ?? item?.repairCost ?? 0) || 0)
/** Uses left (maxDurability - damage), or Infinity when unknown. Pure. */
export function usesLeft (item, registry = null) {
  const max = Number(registry?.itemsByName?.[item?.name]?.maxDurability ?? item?.maxDurability)
  const used = Number(item?.componentMap?.get?.('damage')?.data ?? item?.durabilityUsed ?? 0) || 0
  return Number.isFinite(max) && max > 0 ? Math.max(0, max - used) : Infinity
}

/** THE TOOLS IN A BAG, best first: kind (pickaxe first), tier, uses left. -> [{ item, kind, tier, uses }]. Pure. */
export function rankTools (items = [], registry = null) {
  return (Array.isArray(items) ? items : []).map(item => ({ item, t: toolOf(item?.name) })).filter(x => x.t)
    .map(({ item, t }) => ({ item, kind: t.kind, tier: t.tier, uses: usesLeft(item, registry) }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || b.uses - a.uses)
}

/**
 * WHAT ONE BOOK WOULD DO TO ONE TOOL ON THE ANVIL -> { cost, gain: [{ name, from, to }] } | null (nothing gained). Pure.
 * Vanilla 1.21: per book enchantment the tool accepts and that conflicts with none of the tool's, the result level is
 * max(tool, book), or +1 when they are equal (to the max); cost += result level x the book cost (item cost / 2, >= 1); an
 * incompatible enchantment adds 1; plus both items' prior-work penalties. No gain (every enchantment already as high, or
 * all rejected) -> null: the anvil would refuse it.
 */
export function anvilEstimate (tool, book, registry = null) {
  const t = toolOf(tool?.name)
  if (!t || book?.name !== 'enchanted_book') return null
  const have = new Map(enchantsOf(tool, registry, { stored: false }).map(e => [e.name, e.level]))
  const gain = []
  let cost = repairCostOf(tool) + repairCostOf(book)
  for (const e of enchantsOf(book, registry, { stored: true })) {
    const info = ENCH_INFO[e.name]
    const conflicts = EXCLUSIVE.some(g => g.includes(e.name) && g.some(o => o !== e.name && have.has(o)))
    if (!info || !APPLIES[t.kind].includes(e.name) || conflicts) { cost += 1; continue }
    const cur = have.get(e.name) ?? 0
    const to = Math.min(info.max, cur === e.level ? e.level + 1 : Math.max(cur, e.level))
    cost += to * Math.max(1, Math.floor(info.cost / 2))
    if (to > cur) gain.push({ name: e.name, from: cur, to })
  }
  return gain.length ? { cost, gain } : null
}

/** May the bot take the anvil's result? The SERVER's cost (window property 0), its level, survival. Pure. */
export const anvilTakeOk = (cost, level) => Number.isFinite(cost) && cost > 0 && cost < TOO_EXPENSIVE && Number(level) >= cost

/**
 * WHICH BOOK GOES ON WHICH TOOL -> { tool, book, cost, gain } | { skip }. Pure. Tools best first (rankTools: the best
 * pickaxe first), books in BOOK_ORDER of their best enchantment; the first pair that gains something and that the bot can
 * pay (estimate <= level, < 40). skip: 'no_book' | 'no_tool' | 'no_gain' | 'too_expensive' | 'xp' (with `need`).
 */
export function anvilPlan ({ items = [], level = 0, registry = null } = {}) {
  const books = (Array.isArray(items) ? items : []).filter(i => i?.name === 'enchanted_book')
  if (!books.length) return { skip: 'no_book' }
  const tools = rankTools(items, registry)
  if (!tools.length) return { skip: 'no_tool' }
  const rank = b => Math.min(...enchantsOf(b, registry, { stored: true }).map(e => { const i = BOOK_ORDER.indexOf(e.name); return i < 0 ? 99 : i }), 99)
  const ordered = books.slice().sort((a, b) => rank(a) - rank(b))
  let need = Infinity, expensive = false
  for (const t of tools) {
    for (const book of ordered) {
      const est = anvilEstimate(t.item, book, registry)
      if (!est) continue
      if (est.cost >= TOO_EXPENSIVE) { expensive = true; continue }
      if (est.cost > level) { need = Math.min(need, est.cost); continue }
      return { tool: t.item, book, cost: est.cost, gain: est.gain }
    }
  }
  if (Number.isFinite(need)) return { skip: 'xp', need }
  return { skip: expensive ? 'too_expensive' : 'no_gain' }
}

/**
 * THE ANVIL ASK -> { order } | { skip }. Pure (the caller passes what it read). A book in the bag with a plan: go. No book in
 * the bag but the town index shows one, the bag has a tool, the level pays the cheapest book (2), no recent town-book miss:
 * go (the skill withdraws one). An anvil must be within STATION_FIND.
 */
export function anvilAskPlan ({ on = ANVILAPPLY.on, items = [], level = 0, registry = null, anvilNear = false, townBooks = 0,
  lastAskAt = -Infinity, bookMissAt = -Infinity, now = 0, health = 20 } = {}) {
  if (!on) return { skip: 'off' }
  if (now - lastAskAt < ASK_EVERY_MS) return { skip: 'cooldown' }
  if (health <= 10) return { skip: 'health' }
  if (!anvilNear) return { skip: 'no_anvil' }
  const p = anvilPlan({ items, level, registry })
  if (p.tool) return { order: { skill: 'anvil_apply', args: {} }, plan: p }
  if (p.skip !== 'no_book') return { skip: p.skip, need: p.need }
  if (!(townBooks > 0)) return { skip: 'no_book' }
  if (!rankTools(items, registry).length) return { skip: 'no_tool' }
  if (level < 2) return { skip: 'xp', need: 2 }
  if (now - bookMissAt < BOOK_MISS_MS) return { skip: 'book_miss' }
  return { order: { skill: 'anvil_apply', args: { town: 1 } } }
}

// ---- the enchanting table ---------------------------------------------------------------------------------------------
/** THE TOOL TO ENCHANT -> item | null: the best tool carrying no enchantment (the table refuses an enchanted one). Pure. */
export function enchantTarget (items = [], registry = null) {
  return rankTools(items, registry).find(t => enchantsOf(t.item, registry, { stored: false }).length === 0)?.item ?? null
}
/**
 * WHICH OFFER -> index 0..2 | null. Pure. offers: [{ level }] as the server priced them (0 / -1 = none). The highest offer
 * the bot can pay: offer i needs level >= offers[i].level and costs i+1 levels and i+1 lapis.
 */
export function offerChoice (offers = [], level = 0, lapis = 0) {
  for (let i = Math.min(2, (offers?.length ?? 0) - 1); i >= 0; i--) {
    const req = Number(offers[i]?.level)
    if (req > 0 && level >= req && level >= i + 1 && lapis >= i + 1) return i
  }
  return null
}
const lapisIn = items => (Array.isArray(items) ? items : []).filter(i => i?.name === 'lapis_lazuli').reduce((n, i) => n + (i.count ?? 0), 0)
/**
 * THE TABLE ASK -> { order } | { skip }. Pure. A table within STATION_FIND, level >= TABLE_MIN_LEVEL, a tool with no
 * enchantment, lapis in the bag or in town. ANVIL FIRST: while the anvil has work (`anvilWork`) the table waits, so the
 * levels a book needs are not spent on a random offer.
 */
export function tableAskPlan ({ on = ENCHANTTOOL.on, items = [], level = 0, registry = null, tableNear = false, townLapis = 0,
  lastAskAt = -Infinity, now = 0, health = 20, anvilWork = false } = {}) {
  if (!on) return { skip: 'off' }
  if (now - lastAskAt < ASK_EVERY_MS) return { skip: 'cooldown' }
  if (health <= 10) return { skip: 'health' }
  if (!tableNear) return { skip: 'no_table' }
  if (anvilWork) return { skip: 'anvil_first' }
  if (level < TABLE_MIN_LEVEL) return { skip: 'xp', need: TABLE_MIN_LEVEL }
  if (!enchantTarget(items, registry)) return { skip: 'no_tool' }
  const lapis = lapisIn(items)
  if (lapis < 1 && !(townLapis > 0)) return { skip: 'no_lapis' }
  return { order: { skill: 'enchant_tool', args: lapis < 3 && townLapis > 0 ? { town: 1 } : {} } }
}

// ---- rows -------------------------------------------------------------------------------------------------------------
const gainStr = g => (Array.isArray(g) ? g : []).map(e => `${e.name}${e.from}->${e.to}`).join('+') || '-'
export const anvilModeDetail = on => `on=${on ? 1 : 0} find=${STATION_FIND} every_min=${ASK_EVERY_MS / 60000} too_expensive=${TOO_EXPENSIVE} book_miss_h=${BOOK_MISS_MS / 3600000}`
export const tableModeDetail = on => `on=${on ? 1 : 0} find=${STATION_FIND} every_min=${ASK_EVERY_MS / 60000} min_level=${TABLE_MIN_LEVEL} lapis_take=${LAPIS_TAKE}`
/** `_anvil_apply` detail. Pure. */
export const anvilDetail = ({ stop = '-', tool = null, book = null, cost = null, levels = null, gain = null, at = null } = {}) =>
  `stop=${stop} tool=${tool ?? '-'} book=${book ?? '-'} cost=${cost ?? '-'} levels=${levels ?? '-'} gain=${gainStr(gain)} at=${at ?? '-'}`.slice(0, 290)
/** `_enchant_tool` detail. Pure. */
export const tableDetail = ({ stop = '-', tool = null, offers = null, choice = null, levels = null, lapis = null, got = null, at = null } = {}) =>
  `stop=${stop} tool=${tool ?? '-'} offers=${Array.isArray(offers) ? offers.map(o => o?.level ?? 0).join('/') : '-'} choice=${choice ?? '-'} levels=${levels ?? '-'} lapis=${lapis ?? '-'} got=${gainStr(got)} at=${at ?? '-'}`.slice(0, 290)

// ---- the window drivers (the proof's method; they take the bot) -------------------------------------------------------
const wait = ms => new Promise(r => setTimeout(r, ms))
async function until (f, ms, step = 100) {
  const t = Date.now()
  for (;;) { const v = f(); if (v || Date.now() - t >= ms) return v; await wait(step) }
}
const race = (p, ms, what) => Promise.race([p, wait(ms).then(() => { throw new Error(`${what} timed out`) })])
/** A WINDOW-numbered item of the open window's player section that matches. */
export const winItem = (win, pred) => (win?.slots ?? []).slice(win.inventoryStart, win.inventoryEnd).find(i => i && pred(i)) ?? null
/** The same physical item in a window: name + identical enchantments + repair cost + damage (slot numbers differ). */
const SAME_KEYS = ['enchantments', 'stored_enchantments', 'repair_cost', 'damage', 'custom_name']
const compKey = it => JSON.stringify(SAME_KEYS.map(k => it?.componentMap?.get?.(k)?.data ?? null))
export const sameItem = a => b => !!b && b.name === a?.name && compKey(b) === compKey(a)

async function openWithProps (bot, block) {
  const props = {}
  const onProp = p => { if (bot.currentWindow && p.windowId === bot.currentWindow.id) props[p.property] = p.value }
  bot._client.on('craft_progress_bar', onProp)
  let win
  try { win = await race(bot.openBlock(block), OPEN_WAIT_MS, 'open') } catch (e) { bot._client.removeListener('craft_progress_bar', onProp); throw e }
  const off = () => bot._client.removeListener('craft_progress_bar', onProp)
  win.once?.('close', off)
  return { win, props, off }
}

/**
 * THE ANVIL, BY HAND -> { stop, cost, levelBefore, levelAfter, result } . `tool` / `book` are bag items (matched in the window
 * by sameItem). stop: 'applied' (the server took the levels and the result is in the bag) | 'no_result' | 'refused_cost'
 * (this side would not pay: cost >= 40 or > level; nothing taken) | 'not_taken' | 'no_items' | 'open_failed:<why>'.
 */
export async function anvilCombine (bot, anvilBlock, tool, book) {
  let o
  try { o = await openWithProps(bot, anvilBlock) } catch (e) { return { stop: `open_failed:${String(e?.message ?? e).slice(0, 40)}` } }
  const { win, props } = o
  const out = { stop: 'no_result', cost: null, levelBefore: bot.experience?.level ?? null, levelAfter: null, result: null }
  try {
    if (!/anvil/.test(String(win.type ?? ''))) { out.stop = `open_failed:type_${win.type}`; return out }
    const t = winItem(win, sameItem(tool)), b = winItem(win, sameItem(book))
    if (!t || !b) { out.stop = 'no_items'; return out }
    await bot.clickWindow(t.slot, 0, 0); await bot.clickWindow(0, 0, 0)
    await bot.clickWindow(b.slot, 0, 0); await bot.clickWindow(1, 0, 0)
    const res = await until(() => win.slots[2], RESULT_WAIT_MS)
    if (!res) return out
    await until(() => props[0] != null, 1_000)
    out.cost = props[0] ?? null
    out.result = res
    if (!anvilTakeOk(out.cost, bot.experience?.level ?? 0)) { out.stop = 'refused_cost'; return out }
    const lv0 = bot.experience?.level ?? 0
    await bot.clickWindow(2, 0, 1)   // shift-click the result into the bag
    const paid = await until(() => (bot.experience?.level ?? lv0) <= lv0 - out.cost && !win.slots[2], 3_000)
    out.stop = paid ? 'applied' : 'not_taken'
    return out
  } catch (e) {
    out.stop = `error:${String(e?.message ?? e).slice(0, 40)}`
    return out
  } finally {
    try { bot.closeWindow(win) } catch { /* closed */ }
    await wait(600)
    out.levelAfter = bot.experience?.level ?? null
  }
}

/**
 * THE TABLE -> { stop, offers, choice, levelBefore, levelAfter, got }. `tool` is a bag item (matched in the window). stop:
 * 'enchanted' | 'no_offer' (none the bot can pay) | 'no_lapis' | 'no_items' | 'no_result' | 'open_failed:<why>'.
 */
export async function enchantAtTable (bot, tableBlock, tool, registry = bot?.registry) {
  let o
  try { o = await openWithProps(bot, tableBlock) } catch (e) { return { stop: `open_failed:${String(e?.message ?? e).slice(0, 40)}` } }
  const { win, props } = o
  const out = { stop: 'no_offer', offers: null, choice: null, levelBefore: bot.experience?.level ?? null, levelAfter: null, got: null }
  try {
    if (!/enchant/.test(String(win.type ?? ''))) { out.stop = `open_failed:type_${win.type}`; return out }
    const t = winItem(win, sameItem(tool))
    const lap = winItem(win, i => i.name === 'lapis_lazuli')
    if (!t) { out.stop = 'no_items'; return out }
    if (!lap) { out.stop = 'no_lapis'; return out }
    await bot.clickWindow(t.slot, 0, 0); await bot.clickWindow(0, 0, 0)
    await bot.clickWindow(lap.slot, 0, 0); await bot.clickWindow(1, 0, 0)
    if (win.selectedItem) { try { await bot.clickWindow(lap.slot, 0, 0) } catch { /* cursor */ } }   // a cursor left over goes back
    const priced = await until(() => [0, 1, 2].some(i => (props[i] ?? 0) > 0), OFFER_WAIT_MS)
    await wait(OFFER_SETTLE_MS)
    out.offers = [0, 1, 2].map(i => ({ level: props[i] ?? 0, enchant: props[4 + i] ?? -1, enchLevel: props[7 + i] ?? -1 }))
    if (!priced) return out
    const lapisNow = win.slots[1]?.name === 'lapis_lazuli' ? win.slots[1].count : 0
    out.choice = offerChoice(out.offers, bot.experience?.level ?? 0, lapisNow)
    if (out.choice == null) return out
    const lv0 = bot.experience?.level ?? 0
    bot._client.write('enchant_item', { windowId: win.id, enchantment: out.choice })
    const done = await until(() => enchantsOf(win.slots[0], registry, { stored: win.slots[0]?.name === 'enchanted_book' }).length > 0 && (bot.experience?.level ?? lv0) < lv0, 4_000)
    if (!done) { out.stop = 'no_result'; return out }
    out.got = enchantsOf(win.slots[0], registry, { stored: false }).map(e => ({ name: e.name, from: 0, to: e.level }))
    out.stop = 'enchanted'
    await bot.clickWindow(0, 0, 1)   // shift-click the tool back
    if (win.slots[1]) await bot.clickWindow(1, 0, 1)   // and what lapis is left
    return out
  } catch (e) {
    out.stop = `error:${String(e?.message ?? e).slice(0, 40)}`
    return out
  } finally {
    try { bot.closeWindow(win) } catch { /* closed */ }
    await wait(600)
    out.levelAfter = bot.experience?.level ?? null
  }
}
