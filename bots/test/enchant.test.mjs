// anvilapply-01 + enchant-01 (enchant.mjs): the anvil and enchanting-table decisions and window drivers. Behaviour: the pure
// planners on items shaped as mineflayer 4.37 builds them on Paper 1.21.8 (componentMap `enchantments` / `stored_enchantments`
// = { enchantments: [{ id, level }] }, sandbox3 2026-11-03, docs/reports/anvilproof-2026-11-03.md), the window drivers against a
// fake server that behaves as the proof's Paper did (result in slot 2 + cost as property 0; an unaffordable take refused; the
// table's zero properties at open, its prices a moment later), and buildOrder with the ask set. Structural (behaviour cannot
// reach it): the skills are registered and features.mjs calls the install. Mutants assert their anchor is present and unique.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-enchant-logs-'))
process.env.BOT_NAME = 'EnchantBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-enchant-pool-'))

const E = await import('../src/enchant.mjs')
const require = createRequire(import.meta.url)
const REG = require('minecraft-data')('1.21.8')
const ID = n => REG.enchantmentsByName[n].id
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) } }

const comps = o => new Map(Object.entries(o).map(([k, v]) => [k, { type: k, data: v }]))
const ench = list => ({ enchantments: list.map(([n, level]) => ({ id: ID(n), level })) })
const tool = (name, list = [], extra = {}) => ({ name, count: 1, componentMap: comps({ ...(list.length ? { enchantments: ench(list) } : {}), ...extra }) })
const book = (list, extra = {}) => ({ name: 'enchanted_book', count: 1, componentMap: comps({ stored_enchantments: ench(list), ...extra }) })
const lapis = n => ({ name: 'lapis_lazuli', count: n, componentMap: new Map() })

await t('enchantsOf reads the 1.21.8 components (tool: enchantments, book: stored_enchantments) by registry id; a plain list too', () => {
  assert.deepEqual(E.enchantsOf(tool('iron_pickaxe', [['efficiency', 2], ['unbreaking', 1]]), REG), [{ name: 'efficiency', level: 2 }, { name: 'unbreaking', level: 1 }])
  assert.deepEqual(E.enchantsOf(book([['mending', 1]]), REG), [{ name: 'mending', level: 1 }])
  // a book's tool-side list is not its enchantment (the bug prismarine-item 1.18 has: enchants [] on a book)
  assert.deepEqual(E.enchantsOf(book([['mending', 1]]), REG, { stored: false }), [])
  assert.deepEqual(E.enchantsOf({ name: 'iron_axe', enchants: [{ name: 'sharpness', lvl: 2 }] }, REG), [{ name: 'sharpness', level: 2 }])
  assert.deepEqual(E.enchantsOf(tool('iron_pickaxe'), REG), [])
})

await t('anvilEstimate matches the proof: Mending book on a plain iron pickaxe 2 levels, Unbreaking III 3', () => {
  assert.deepEqual(E.anvilEstimate(tool('iron_pickaxe'), book([['mending', 1]]), REG), { cost: 2, gain: [{ name: 'mending', from: 0, to: 1 }] })
  assert.equal(E.anvilEstimate(tool('iron_pickaxe'), book([['unbreaking', 3]]), REG).cost, 3)
})

await t('anvilEstimate: equal levels combine +1 (to the max); already as high -> null; a conflict or a wrong kind gains nothing; prior work adds', () => {
  assert.deepEqual(E.anvilEstimate(tool('iron_pickaxe', [['efficiency', 2]]), book([['efficiency', 2]]), REG).gain, [{ name: 'efficiency', from: 2, to: 3 }])
  assert.equal(E.anvilEstimate(tool('iron_pickaxe', [['mending', 1]]), book([['mending', 1]]), REG), null, 'mending max 1: nothing gained')
  assert.equal(E.anvilEstimate(tool('iron_pickaxe', [['efficiency', 5]]), book([['efficiency', 3]]), REG), null)
  assert.equal(E.anvilEstimate(tool('iron_pickaxe', [['silk_touch', 1]]), book([['fortune', 3]]), REG), null, 'fortune excludes silk touch')
  assert.equal(E.anvilEstimate(tool('iron_sword'), book([['efficiency', 1]]), REG), null, 'a sword takes no efficiency')
  assert.ok(E.anvilEstimate(tool('iron_sword'), book([['sharpness', 1]]), REG), 'POSITIVE CONTROL: a sword takes sharpness')
  assert.equal(E.anvilEstimate(tool('iron_pickaxe', [], { repair_cost: 3 }), book([['mending', 1]], { repair_cost: 1 }), REG).cost, 2 + 3 + 1)
  assert.equal(E.anvilEstimate({ name: 'stick' }, book([['mending', 1]]), REG), null)
})

await t('anvilTakeOk: the server cost must be paid and below 40 (survival "Too Expensive")', () => {
  assert.equal(E.anvilTakeOk(2, 10), true)
  assert.equal(E.anvilTakeOk(39, 39), true)
  assert.equal(E.anvilTakeOk(40, 50), false)
  assert.equal(E.anvilTakeOk(3, 2), false)
  assert.equal(E.anvilTakeOk(0, 10), false)
  assert.equal(E.anvilTakeOk(null, 10), false)
})

await t('anvilPlan: the best pickaxe first (pickaxe > axe, diamond > iron), Mending before Efficiency; skips say why', () => {
  const items = [tool('iron_axe'), tool('iron_pickaxe'), tool('diamond_pickaxe'), book([['efficiency', 1]]), book([['mending', 1]])]
  const p = E.anvilPlan({ items, level: 10, registry: REG })
  assert.equal(p.tool.name, 'diamond_pickaxe')
  assert.equal(E.enchantsOf(p.book, REG)[0].name, 'mending')
  assert.equal(p.cost, 2)
  // the best pickaxe already has mending: the efficiency book goes on it, not mending on the iron one
  const q = E.anvilPlan({ items: [tool('iron_pickaxe'), tool('diamond_pickaxe', [['mending', 1]]), book([['mending', 1]]), book([['efficiency', 1]])], level: 10, registry: REG })
  assert.equal(q.tool.name, 'diamond_pickaxe'); assert.equal(E.enchantsOf(q.book, REG)[0].name, 'efficiency')
  assert.deepEqual(E.anvilPlan({ items: [tool('iron_pickaxe'), book([['mending', 1]])], level: 1, registry: REG }), { skip: 'xp', need: 2 })
  assert.deepEqual(E.anvilPlan({ items: [tool('iron_pickaxe', [], { repair_cost: 39 }), book([['mending', 1]])], level: 60, registry: REG }), { skip: 'too_expensive' })
  assert.deepEqual(E.anvilPlan({ items: [tool('iron_pickaxe')], level: 10, registry: REG }), { skip: 'no_book' })
  assert.deepEqual(E.anvilPlan({ items: [book([['mending', 1]])], level: 10, registry: REG }), { skip: 'no_tool' })
  assert.deepEqual(E.anvilPlan({ items: [tool('iron_sword'), book([['efficiency', 1]])], level: 10, registry: REG }), { skip: 'no_gain' })
})

await t('anvilAskPlan: a bag book goes; a town book only with a tool, 2 levels and no recent miss; cooldown, health, no anvil', () => {
  const base = { on: true, registry: REG, anvilNear: true, now: 10 * 3600_000, level: 10 }
  assert.equal(E.anvilAskPlan({ ...base, items: [tool('iron_pickaxe'), book([['mending', 1]])] }).order.skill, 'anvil_apply')
  assert.deepEqual(E.anvilAskPlan({ ...base, items: [tool('iron_pickaxe')], townBooks: 1 }).order, { skill: 'anvil_apply', args: { town: 1 } })
  assert.equal(E.anvilAskPlan({ ...base, items: [tool('iron_pickaxe')], townBooks: 0 }).skip, 'no_book')
  assert.equal(E.anvilAskPlan({ ...base, items: [], townBooks: 1 }).skip, 'no_tool')
  assert.equal(E.anvilAskPlan({ ...base, items: [tool('iron_pickaxe')], townBooks: 1, level: 1 }).skip, 'xp')
  assert.equal(E.anvilAskPlan({ ...base, items: [tool('iron_pickaxe')], townBooks: 1, bookMissAt: base.now - 60_000 }).skip, 'book_miss')
  assert.equal(E.anvilAskPlan({ ...base, items: [tool('iron_pickaxe'), book([['mending', 1]])], lastAskAt: base.now - 60_000 }).skip, 'cooldown')
  assert.equal(E.anvilAskPlan({ ...base, items: [tool('iron_pickaxe'), book([['mending', 1]])], health: 8 }).skip, 'health')
  assert.equal(E.anvilAskPlan({ ...base, items: [tool('iron_pickaxe'), book([['mending', 1]])], anvilNear: false }).skip, 'no_anvil')
  assert.equal(E.anvilAskPlan({ ...base, on: false, items: [tool('iron_pickaxe'), book([['mending', 1]])] }).skip, 'off')
})

await t('offerChoice: the highest offer the bot can pay (level >= its price, i+1 levels and i+1 lapis); none -> null', () => {
  const offers = [{ level: 1 }, { level: 5 }, { level: 8 }]   // the proof's no-bookshelf table
  assert.equal(E.offerChoice(offers, 10, 10), 2)
  assert.equal(E.offerChoice(offers, 7, 10), 1)
  assert.equal(E.offerChoice(offers, 10, 2), 1, 'two lapis: offer 3 needs three')
  assert.equal(E.offerChoice(offers, 10, 1), 0)
  assert.equal(E.offerChoice(offers, 10, 0), null)
  assert.equal(E.offerChoice([{ level: 0 }, { level: 0 }, { level: 0 }], 30, 64), null, 'unpriced (the zeros at open) is no offer')
  assert.equal(E.offerChoice([{ level: 1 }, { level: 3 }, { level: 0 }], 10, 10), 1)
})

await t('enchantTarget + tableAskPlan: the best tool with no enchantment; anvil work first; the level floor; lapis from town', () => {
  assert.equal(E.enchantTarget([tool('diamond_pickaxe', [['mending', 1]]), tool('iron_pickaxe'), tool('stone_axe')], REG).name, 'iron_pickaxe')
  assert.equal(E.enchantTarget([tool('diamond_pickaxe', [['mending', 1]])], REG), null)
  const base = { on: true, registry: REG, tableNear: true, now: 10 * 3600_000, level: 10, items: [tool('iron_pickaxe'), lapis(5)] }
  assert.deepEqual(E.tableAskPlan(base).order, { skill: 'enchant_tool', args: {} })
  assert.equal(E.tableAskPlan({ ...base, anvilWork: true }).skip, 'anvil_first')
  assert.equal(E.tableAskPlan({ ...base, level: E.TABLE_MIN_LEVEL - 1 }).skip, 'xp')
  assert.equal(E.tableAskPlan({ ...base, items: [tool('iron_pickaxe')] }).skip, 'no_lapis')
  assert.deepEqual(E.tableAskPlan({ ...base, items: [tool('iron_pickaxe')], townLapis: 30 }).order.args, { town: 1 })
  assert.equal(E.tableAskPlan({ ...base, items: [tool('iron_pickaxe', [['efficiency', 1]]), lapis(5)] }).skip, 'no_tool')
  assert.equal(E.tableAskPlan({ ...base, tableNear: false }).skip, 'no_table')
})

// ---- the fake server -----------------------------------------------------------------------------------------------
/** A bot whose window behaves as Paper 1.21.8 did in the proof. kind: 'anvil' | 'table'. */
function fakeBot ({ kind, bag, level, cost = 2, result = null, offers = [1, 5, 8], priceDelayMs = 150, enchantGives = [['efficiency', 1]] }) {
  const client = new EventEmitter()
  const bot = { _client: client, experience: { level }, registry: REG, clicks: [], wrote: [], currentWindow: null }
  const start = kind === 'anvil' ? 3 : 2
  const win = Object.assign(new EventEmitter(), { id: 7, type: kind === 'anvil' ? 'minecraft:anvil' : 'minecraft:enchantment', inventoryStart: start, inventoryEnd: start + 36, slots: new Array(start + 36).fill(null), selectedItem: null })
  bag.forEach((it, i) => { win.slots[start + i] = { ...it, slot: start + i } })
  const prop = (property, value) => client.emit('craft_progress_bar', { windowId: win.id, property, value })
  const anvilUpdate = () => {
    if (win.slots[0] && win.slots[1]) { win.slots[2] = { ...(result ?? win.slots[0]), slot: 2 }; prop(0, cost) } else win.slots[2] = null
  }
  const tableUpdate = () => {
    if (win.slots[0]) setTimeout(() => offers.forEach((lv, i) => setTimeout(() => prop(i, lv), 40 * i)), priceDelayMs)
    else [0, 1, 2].forEach(i => prop(i, 0))
  }
  bot.openBlock = async () => {
    bot.currentWindow = win
    if (kind === 'table') setTimeout(() => [0, 1, 2].forEach(i => prop(i, 0)), 10)   // the zeros at open: mineflayer's early 'ready'
    return win
  }
  bot.closeWindow = () => { bot.currentWindow = null; win.emit('close') }
  const firstEmpty = () => { for (let i = start; i < win.inventoryEnd; i++) if (!win.slots[i]) return i; return -1 }
  bot.clickWindow = async (slot, button, mode) => {
    bot.clicks.push([slot, button, mode])
    assert.ok(slot >= 0 && slot < win.inventoryEnd, `click outside the window: ${slot}`)
    if (mode === 0) {
      const here = win.slots[slot]
      if (kind === 'anvil' && slot === 2) throw new Error('the fake takes the result by shift-click only')
      win.slots[slot] = win.selectedItem ? { ...win.selectedItem, slot } : null
      win.selectedItem = here
    } else if (mode === 1) {
      if (kind === 'anvil' && slot === 2) {
        if (!win.slots[2] || bot.experience.level < cost || cost >= 40) return   // the server refuses (proof A4)
        const to = firstEmpty(); win.slots[to] = { ...win.slots[2], slot: to }
        win.slots[0] = win.slots[1] = win.slots[2] = null
        setTimeout(() => { bot.experience.level -= cost }, 30)
        return
      }
      const to = firstEmpty(); win.slots[to] = { ...win.slots[slot], slot: to }; win.slots[slot] = null
    }
    if (kind === 'anvil') anvilUpdate(); else if (slot === 0) tableUpdate()
  }
  client.write = (name, data) => {
    bot.wrote.push([name, data])
    if (name === 'enchant_item' && kind === 'table') {
      const i = data.enchantment
      setTimeout(() => {
        win.slots[0] = { ...win.slots[0], componentMap: comps({ enchantments: ench(enchantGives) }) }
        win.slots[1] = win.slots[1].count > i + 1 ? { ...win.slots[1], count: win.slots[1].count - (i + 1) } : null
        bot.experience.level -= i + 1
      }, 50)
    }
  }
  return { bot, win }
}

await t('anvilCombine: tool -> slot 0, book -> slot 1 by window slot, the result shift-clicked out, the levels paid (the proof A2)', async () => {
  const pick = tool('iron_pickaxe'), bk = book([['mending', 1]])
  const { bot, win } = fakeBot({ kind: 'anvil', bag: [lapis(3), pick, bk], level: 10, cost: 2, result: tool('iron_pickaxe', [['mending', 1]], { repair_cost: 1 }) })
  const r = await E.anvilCombine(bot, {}, pick, bk)
  assert.equal(r.stop, 'applied')
  assert.equal(r.cost, 2)
  assert.equal(r.levelBefore, 10); assert.equal(r.levelAfter, 8)
  assert.deepEqual(bot.clicks.slice(0, 4), [[4, 0, 0], [0, 0, 0], [5, 0, 0], [1, 0, 0]], 'window slots (start 3), not bag slots')
  assert.deepEqual(bot.clicks.at(-1), [2, 0, 1])
  assert.ok(win.slots.slice(3).some(i => i && E.enchantsOf(i, REG).some(e => e.name === 'mending')), 'the mended pickaxe is in the bag')
})

await t('anvilCombine never takes what it cannot pay: level < cost, or cost >= 40, -> refused_cost and no click on slot 2', async () => {
  for (const [level, cost] of [[0, 3], [50, 40]]) {
    const pick = tool('iron_pickaxe'), bk = book([['unbreaking', 3]])
    const { bot } = fakeBot({ kind: 'anvil', bag: [pick, bk], level, cost })
    const r = await E.anvilCombine(bot, {}, pick, bk)
    assert.equal(r.stop, 'refused_cost', `level ${level} cost ${cost}`)
    assert.ok(!bot.clicks.some(([s, , m]) => s === 2 && m === 1), 'no take')
  }
})

await t('anvilCombine matches the exact book: the Unbreaking book is not taken for the Mending plan', async () => {
  const pick = tool('iron_pickaxe'), mend = book([['mending', 1]]), unb = book([['unbreaking', 3]])
  const { bot } = fakeBot({ kind: 'anvil', bag: [unb, pick, mend], level: 10 })
  await E.anvilCombine(bot, {}, pick, mend)
  assert.equal(bot.clicks[2][0], 3 + 2, 'the mending book (bag index 2), not the unbreaking one (index 0)')
})

await t('enchantAtTable: window-numbered items, waits past the zeros at open for the prices, pays the best offer', async () => {
  const pick = tool('iron_pickaxe')
  const { bot, win } = fakeBot({ kind: 'table', bag: [lapis(6), tool('stone_axe'), pick], level: 10, offers: [1, 5, 8] })
  const r = await E.enchantAtTable(bot, {}, pick, REG)
  assert.equal(r.stop, 'enchanted')
  assert.deepEqual(r.offers.map(o => o.level), [1, 5, 8])
  assert.equal(r.choice, 2)
  assert.deepEqual(bot.wrote.find(w => w[0] === 'enchant_item')[1], { windowId: 7, enchantment: 2 })
  assert.deepEqual(bot.clicks.slice(0, 4), [[4, 0, 0], [0, 0, 0], [2, 0, 0], [1, 0, 0]], 'the pickaxe at window slot 4, the lapis at 2')
  assert.equal(r.levelAfter, 7)
  assert.ok(win.slots.slice(2).some(i => i?.name === 'iron_pickaxe' && E.enchantsOf(i, REG).length), 'the enchanted pickaxe is back in the bag')
  assert.ok(!win.slots[0] && !win.slots[1], 'nothing left in the table')
})

await t('enchantAtTable at 6 levels takes offer 2 (5 levels), never offer 3 (8)', async () => {
  const pick = tool('iron_pickaxe')
  const { bot } = fakeBot({ kind: 'table', bag: [lapis(6), pick], level: 6 })
  const r = await E.enchantAtTable(bot, {}, pick, REG)
  assert.equal(r.choice, 1)
})

// ---- buildOrder asks it first ----------------------------------------------------------------------------------------
const S = await import('../src/shop.mjs')
await t('buildOrder: the enchant ask is asked first at town; unset or no order -> the build order as before', () => {
  const base = { on: true, shared: true, atTown: true, planned: true, now: 1e12, state: {} }
  const before = S.buildOrder(base)
  S.setEnchantAsk(() => ({ order: { skill: 'anvil_apply', args: {} } }))
  try {
    assert.deepEqual(S.buildOrder(base), { order: { skill: 'anvil_apply', args: {} }, skip: null })
    assert.deepEqual(S.buildOrder({ ...base, atTown: false }), { order: null, skip: null }, 'not at town: never')
    S.setEnchantAsk(() => null)
    assert.deepEqual(S.buildOrder(base), before)
  } finally { S.setEnchantAsk(null) }
})

// ---- structural -----------------------------------------------------------------------------------------------------
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const FEATURES = new URL('../src/features.mjs', import.meta.url)
const INSTALL_LINE = "try { enchantInstall(bot) } catch (e) { log('warn', 'enchant not installed', { error: e.message }) }"
await t('STRUCTURAL: installFeatures calls enchantInstall; the two skills are registered chatOnly with contracts', async () => {
  assert.equal(strip(readFileSync(FEATURES, 'utf8')).split(INSTALL_LINE).length, 2)
  const K = await import('../src/skills.mjs')
  for (const k of ['anvil_apply', 'enchant_tool']) {
    assert.equal(typeof K.SKILLS[k]?.run, 'function', k)
    assert.equal(K.SKILLS[k].chatOnly, true, k)
    assert.ok(K.SKILL_CONTRACTS[k]?.maxMs > 0, k)
  }
  assert.equal(typeof K.enchantAsk, 'function')
})

// ---- mutants ------------------------------------------------------------------------------------------------------------
const SRC = new URL('../src/enchant.mjs', import.meta.url)
async function withMutant (url, old, neu, fn) {
  const src = readFileSync(url, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 60))}`)
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu).replace(/from '\.\//g, "from '../src/"))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
await t('MUTANT KILLED: the 40-level cap as <= lets a Too Expensive job through', async () => {
  await withMutant(SRC, 'cost > 0 && cost < TOO_EXPENSIVE && Number(level) >= cost', 'cost > 0 && cost <= TOO_EXPENSIVE && Number(level) >= cost', async M => {
    assert.equal(M.anvilTakeOk(40, 50), true, 'the mutant takes it, so the boundary test above is what holds the cap')
  })
})
await t('MUTANT KILLED: offerChoice without the lapis term picks an offer the bag cannot pay', async () => {
  await withMutant(SRC, 'level >= i + 1 && lapis >= i + 1) return i', 'level >= i + 1) return i', async M => {
    assert.equal(M.offerChoice([{ level: 1 }, { level: 5 }, { level: 8 }], 10, 2), 2)
  })
})
await t('MUTANT KILLED: anvilCombine without its pay check clicks the result it cannot afford', async () => {
  await withMutant(SRC, "if (!anvilTakeOk(out.cost, bot.experience?.level ?? 0)) { out.stop = 'refused_cost'; return out }", '', async M => {
    const pick = tool('iron_pickaxe'), bk = book([['unbreaking', 3]])
    const { bot } = fakeBot({ kind: 'anvil', bag: [pick, bk], level: 0, cost: 3 })
    const r = await M.anvilCombine(bot, {}, pick, bk)
    assert.notEqual(r.stop, 'refused_cost'); assert.ok(bot.clicks.some(([s, , m]) => s === 2 && m === 1))
  })
})
await t('MUTANT KILLED: enchantAtTable trusting the first property (the early "ready") reads unpriced offers', async () => {
  await withMutant(SRC, 'const priced = await until(() => [0, 1, 2].some(i => (props[i] ?? 0) > 0), OFFER_WAIT_MS)\n    await wait(OFFER_SETTLE_MS)', 'const priced = true', async M => {
    const pick = tool('iron_pickaxe')
    const { bot } = fakeBot({ kind: 'table', bag: [lapis(6), pick], level: 10, priceDelayMs: 300 })
    const r = await M.enchantAtTable(bot, {}, pick, REG)
    assert.equal(r.stop, 'no_offer', 'the mutant sees the zeros and gives up')
  })
})
await t('MUTANT KILLED: dropping the install line fails the structural assertion', async () => {
  const src = strip(readFileSync(FEATURES, 'utf8'))
  assert.equal(src.split(INSTALL_LINE).length, 2, 'ANCHOR MISSING OR NOT UNIQUE')
  assert.equal(src.replace(INSTALL_LINE, '').split(INSTALL_LINE).length, 1)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
