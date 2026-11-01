// DRAINPICK-01 (withdraw_pick half): AT TOWN WITH NO TRIP PICKAXE, THE ORDER MAKES ONE FROM THE BAG.
//
// MEASURED 24 h to 11-01 21:38Z (80 bots, 1,861,617 skill rows walked): 739 withdraw_pick orders, 137 success. 464 failed
// "none of stick:N in the N container(s) tried here" -- and 449 of those bags held logs or >= 2 planks with 3+ cobblestone,
// i.e. they could MAKE the sticks; 118 more ended no_effect "the bag already holds what one stone pickaxe takes". In the
// bot's next 7 skills, 433 of the 464 and 98 of the 118 crafted nothing: the remedy ("the rung's own order crafts it") was
// never taken, because the rung's craftReady asks mineflayer's recipesFor for the pickaxe itself, which needs sticks IN the
// bag. So:
//   1. stonePickDeficits counts sticks the bag can make (2 planks on top of the table's 4) as held -- no stick search;
//   2. townIngredientMiss is no longer "futile" for a ready bag -- the order is issued;
//   3. withdraw_pick crafts the stone_pickaxe itself (the existing craft: sticks/planks/table sub-crafts) when the bag is
//      ready and no chest pickaxe was taken -- the remedy executed where the bot stands, not printed.
// Behaviour: the pure rule against the craft PLANNER on the real 1.21.8 recipes (they must agree on every bag in a grid),
// the real withdraw_pick -> craft -> mineflayer craft.js -> fake Paper (the server's counts are the oracle), the order chain
// (gate -> issue -> craft -> no re-issue), and anchored mutants.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-pickcraft-logs-'))
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-pickcraft-pool-'))
process.env.MEMORY_SCOPE = 'shared'
process.env.MEMORY_POOL = 'pickcraft-test'
process.env.BOT_NAME = 'PickBot'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.LOG_LEVEL = 'error'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.BOT_ROLE = 'gatherer'
process.env.PLINTH_FIRST = '0'
process.env.SKILL_TIMEOUT_MS = '180000'   // the order's clock is the runner's timeout; the suite's 300 ms leaves none
import * as CS from '../src/craftsync.mjs'
import { planCraft } from '../src/craftplan.mjs'
import { FakePaper, craftBot, learnAll, fakeWorld } from './helpers/fake-paper-craft.mjs'
const W = await import('../src/withdrawpick.mjs')
const { townOrder } = await import('../src/composter.mjs')
const S = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack ?? e.message}`) }
}
const stack = (name, count) => ({ name, count })

// ---- 1. the pure rule ------------------------------------------------------------------------------------------------
await t('stonePickDeficits: sticks the bag can make are not a deficit; the table\'s 4 planks come first', () => {
  const D = (items, o) => W.stonePickDeficits(items, o)
  // the measured shape: logs + cobble + a table, no sticks -> nothing to fetch (it was stick:2)
  assert.deepEqual(D([stack('oak_log', 3), stack('cobblestone', 30), stack('crafting_table', 1)]), [])
  assert.deepEqual(D([stack('birch_planks', 2), stack('cobblestone', 3)], { tableNear: true }), [], '2 planks make 4 sticks')
  assert.deepEqual(D([stack('birch_planks', 1), stack('cobblestone', 3)], { tableNear: true }), [{ need: 'stick', count: 2 }], '1 plank makes none')
  // no table anywhere: 4 planks for it AND 2 for the sticks
  assert.deepEqual(D([stack('oak_log', 1), stack('cobblestone', 3)]), [{ need: 'stick', count: 2 }], 'one log is the table, not the sticks too')
  assert.deepEqual(D([stack('oak_log', 2), stack('cobblestone', 3)]), [])
  assert.deepEqual(D([stack('oak_planks', 6), stack('cobblestone', 3), stack('stick', 1)]), [])
  // unchanged where there is no wood (the old rows exactly)
  assert.deepEqual(D([]), [{ need: 'cobblestone', count: 3 }, { need: 'stick', count: 2 }, { need: 'planks', count: 4 }])
  assert.deepEqual(D([], { tableNear: true }), [{ need: 'cobblestone', count: 3 }, { need: 'stick', count: 2 }])
  assert.equal(W.stonePickReady([stack('oak_log', 2), stack('cobbled_deepslate', 3)]), true)
  // one recipe, one kind (Claude r1 note 1): 3 oak + 3 birch planks make no table; 2 cobblestone + 1 deepslate no pickaxe
  assert.deepEqual(D([stack('oak_planks', 3), stack('birch_planks', 3), stack('cobblestone', 3)]), [{ need: 'stick', count: 2 }, { need: 'planks', count: 1 }])
  assert.deepEqual(D([stack('oak_planks', 4), stack('birch_planks', 2), stack('cobblestone', 3)]), [], 'the table from oak, the sticks from birch')
  assert.deepEqual(D([stack('cobblestone', 2), stack('cobbled_deepslate', 1), stack('stick', 2)], { tableNear: true }), [{ need: 'cobblestone', count: 1 }])
})

const reg = craftBot(new FakePaper({})).registry
const probe = craftBot(new FakePaper({}))
const made = r => (r.delta ?? []).filter(d => d.count > 0).reduce((n, d) => n + d.count, 0)
const shape = r => ({ ref: r, yield: r.result?.count || made(r) || 1, table: !!r.requiresTable,
  ingredients: (r.delta ?? []).filter(d => d.count < 0).map(d => ({ name: reg.items[d.id]?.name, count: -d.count })) })
const recipesOf = name => { const d = reg.itemsByName[name]; return d ? probe.recipesAll(d.id, null, true).map(shape) : [] }
await t('THE RULE AGREES WITH THE CRAFT PLANNER on the real recipes: a bag is "ready" exactly when craft can plan the stone_pickaxe', () => {
  let n = 0, readyN = 0
  const bad = []
  // mixed kinds too (Claude r1 note 1): a second wood and a second stone, which no single recipe can combine
  for (const cobble of [0, 2, 3]) for (const deep of [0, 1]) for (const sticks of [0, 1, 2]) for (const planks of [0, 1, 2, 3, 4, 5, 6]) for (const logs of [0, 1, 2])
    for (const birch of [0, 2, 3]) for (const table of ['none', 'carried', 'near']) {
      const have = {}
      if (cobble) have.cobblestone = cobble
      if (deep) have.cobbled_deepslate = deep
      if (birch) have.birch_planks = birch
      if (sticks) have.stick = sticks
      if (planks) have.oak_planks = planks
      if (logs) have.oak_log = logs
      if (table === 'carried') have.crafting_table = 1
      const items = Object.entries(have).map(([name, count]) => stack(name, count))
      const ready = W.stonePickReady(items, { tableNear: table === 'near' })
      if (ready) readyN++
      const p = planCraft({ item: 'stone_pickaxe', count: 1, recipesOf, have, tableReady: table === 'near', prefer: r => r.ingredients.filter(i => /^oak_/.test(i.name)).length })
      n++
      // the rule may be STRICTER than the planner (it never counts a log as sticks beyond its planks), never looser
      if (ready && !p.ok) bad.push(`ready but unplannable: ${JSON.stringify(have)} ${table}`)
      if (!ready && p.ok && cobble >= 3) bad.push(`plannable but not ready: ${JSON.stringify(have)} ${table}`)
    }
  assert.ok(n > 3000, `${n} bags`)
  assert.ok(readyN > 50 && n - readyN > 50, `positive control: both answers occur (${readyN} ready of ${n})`)
  assert.deepEqual(bad, [])
})

// ---- 2. the real order, the real craft, a fake Paper ---------------------------------------------------------------------
/** A town with NO container (the pickaxe search has no candidate) and a bag: run the real withdraw_pick. */
async function order (inv, { tableAt = null, mod = S } = {}) {
  const server = new FakePaper({ lagClicks: 3, fallbackMs: 60, inventory: inv })
  const bot = craftBot(server)
  const placed = fakeWorld(bot, server)
  if (tableAt) placed.set(tableAt, 'crafting_table')
  bot.username = 'PickBot'
  bot.findBlocks = () => []
  await server.sync()
  CS.installCraftSync(bot, {})
  learnAll(bot, server, ['wooden_pickaxe', 'stone_pickaxe', 'stick', 'crafting_table', 'oak_planks', 'birch_planks'])
  const rows = []
  const un = tapRecords(r => { if (r?.skill?.name === '_withdraw_pick') rows.push(r.skill.detail) })
  let out
  try { out = await mod.SKILLS.withdraw_pick.run({ bot }, {}, new AbortController().signal) } finally { un() }
  await server.settle(); server.stop()
  return { out, n: name => server.count(name), rows, bot }
}

await t('THE MEASURED SHAPE: no pickaxe in town, logs + cobblestone, no sticks, no table -> the order CRAFTS the stone_pickaxe (server count 1)', async () => {
  const { out, n, rows } = await order({ 36: ['oak_log', 2], 37: ['cobblestone', 3], 9: ['dirt', 64] })
  assert.equal(out.status, 'success', out.detail)
  assert.equal(n('stone_pickaxe'), 1, 'the SERVER holds the pickaxe')
  assert.match(rows.at(-1), /^outcome=crafted_pick need=none /)
  assert.ok(W.hasUsablePick([{ name: 'stone_pickaxe', count: 1, durabilityUsed: 0, maxDurability: 131 }]))
})
await t('a table in reach is used (no table crafted); planks only, sticks made', async () => {
  const { out, n } = await order({ 36: ['birch_planks', 2], 37: ['cobblestone', 3], 9: ['dirt', 64] }, { tableAt: '1,64,0' })
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual([n('stone_pickaxe'), n('crafting_table'), n('cobblestone')], [1, 0, 0])
})
await t('NOT READY (no wood, no sticks): nothing crafted, the ingredient pass runs and fails short as before -- no craft attempt', async () => {
  const { out, n, rows } = await order({ 37: ['cobblestone', 3], 9: ['dirt', 64] }, { tableAt: '1,64,0' })
  assert.equal(out.status, 'failed', out.detail)
  assert.equal(n('stone_pickaxe'), 0)
  assert.match(rows.at(-1), /^outcome=short need=stick:2 /)
})
await t('A CRAFT THAT CANNOT SUCCEED fails the order (craft_failed: its backoff), with the craft\'s own detail -- never no_effect (which re-orders every 5 min)', async () => {
  // ready by the rule (2 logs + cobble) but the world refuses the table: nowhere to place it
  const server = new FakePaper({ lagClicks: 3, fallbackMs: 60, inventory: { 36: ['oak_log', 2], 37: ['cobblestone', 3], 9: ['dirt', 64] } })
  const bot = craftBot(server); fakeWorld(bot, server)
  bot.username = 'PickBot'; bot.findBlocks = () => []
  bot.placeBlock = async () => { throw new Error('fake world: no room to place') }
  await server.sync(); CS.installCraftSync(bot, {})
  learnAll(bot, server, ['stone_pickaxe', 'stick', 'crafting_table', 'oak_planks'])
  const rows = []
  const un = tapRecords(r => { if (r?.skill?.name === '_withdraw_pick') rows.push(r.skill.detail) })
  let out
  try { out = await S.SKILLS.withdraw_pick.run({ bot }, {}, new AbortController().signal) } finally { un() }
  await server.settle(); server.stop()
  assert.equal(out.status, 'failed', out.detail)
  assert.match(out.detail, /stone_pickaxe craft from the bag failed: \S/)
  assert.match(rows.at(-1), /^outcome=craft_failed /)
  const { townOrderOutcome } = await import('../src/composter.mjs')
  const st = townOrderOutcome('withdraw_pick', out.status, 1e9, {}, out.failClass)
  assert.ok(st.withdrawBackoffUntil > 1e9, `a failed craft backs the order off (failClass ${out.failClass})`)
})

// ---- 3. the chain: the gate issues it for a ready bag even when every chest is a pickaxe miss ---------------------------
await t('THE CHAIN: pickaxe ruled out town-wide + a ready bag -> the order IS issued (it was not: "nothing to fetch"), the craft makes it, then no order', async () => {
  const server = new FakePaper({ lagClicks: 3, fallbackMs: 60, inventory: { 36: ['oak_log', 2], 37: ['cobblestone', 3], 9: ['dirt', 64] } })
  const bot = craftBot(server); fakeWorld(bot, server)
  bot.username = 'PickBot'; bot.findBlocks = () => []
  await server.sync(); CS.installCraftSync(bot, {})
  learnAll(bot, server, ['stone_pickaxe', 'stick', 'crafting_table', 'oak_planks'])
  assert.equal(S.townIngredientMiss(bot), false, 'a ready bag is not futile')
  // the pickaxe branch ruled out town-wide (every chest a recent miss: townsearch.test.mjs proves that reading); the gate's
  // ingredient answer is the REAL one for this bag
  const base = { now: 1e9, slots: 3, freeSlots: 33, junk: 0, distHome: 3, storageNear: true, composterAtTown: false, pickRoom: true,
                 pickMiss: () => true, ingredientMiss: () => S.townIngredientMiss(bot), state: {} }
  assert.equal(townOrder({ ...base, ingredientMiss: () => true, pickNeeded: true }).order, null, 'positive control: the base gate (ready bag = futile) issued nothing')
  const o = townOrder({ ...base, pickNeeded: S.pickNeedOf(bot.inventory.items()) != null })
  assert.equal(o.order?.skill, 'withdraw_pick')
  const out = await S.SKILLS.withdraw_pick.run({ bot }, {}, new AbortController().signal)
  await server.settle()
  assert.equal(out.status, 'success', out.detail)
  assert.equal(S.pickNeedOf(bot.inventory.items()), null, 'the bag now holds a trip pickaxe')
  assert.equal(townOrder({ ...base, now: 1e9 + 1e7, pickNeeded: S.pickNeedOf(bot.inventory.items()) != null }).order, null, 'and no order follows')
  server.stop()
})

// ---- 4. mutants (anchors present and unique) -------------------------------------------------------------------------
const SKILLS_PATH = new URL('../src/skills.mjs', import.meta.url)
const WP_PATH = new URL('../src/withdrawpick.mjs', import.meta.url)
async function withMutant (p, old, neu, fn) {
  const src = readFileSync(p, 'utf8')
  assert.ok(src.split(old).length === 2, `ANCHOR MISSING OR NOT UNIQUE: ${JSON.stringify(old.slice(0, 60))}`)
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
await t('MUTANT KILLED: the old has_ingredients no_effect in place of the craft -> the measured bag gets no pickaxe', async () => {
  await withMutant(SKILLS_PATH,
    "if (!deficits.length) return pickCraftHere(ctx, signal, msLeft, finish, 'the bag already holds what one stone pickaxe takes')",
    "if (!deficits.length) return finish({ status: 'no_effect', detail: 'mutant' }, 'has_ingredients')",
    async mod => {
      const { out, n } = await order({ 36: ['oak_log', 2], 37: ['cobblestone', 3], 9: ['dirt', 64] }, { mod })
      assert.equal(out.status, 'no_effect'); assert.equal(n('stone_pickaxe'), 0, 'the mutant makes no pickaxe: the test above would fail on it')
    })
})
await t('MUTANT KILLED: sticks counted as held only (the old rule) -> the measured bag is "short stick:2" again', async () => {
  await withMutant(WP_PATH,
    'const makeable = stickShort > 0 && (w1 >= tablePlanks + STICK_PLANKS || (tablePlanks > 0 && w1 >= tablePlanks && w2 >= STICK_PLANKS))',
    'const makeable = false',
    async mod => {
      assert.deepEqual(mod.stonePickDeficits([stack('oak_log', 3), stack('cobblestone', 30), stack('crafting_table', 1)]), [{ need: 'stick', count: 2 }])
    })
})

await t('MUTANT KILLED: a ready bag "futile" again (the base gate) -> the chain issues no order', async () => {
  await withMutant(SKILLS_PATH, 'return needs.length > 0 && townSearchEmpty(bot, needs)', 'return needs.length === 0 || townSearchEmpty(bot, needs)', async mod => {
    const server = new FakePaper({ lagClicks: 3, fallbackMs: 60, inventory: { 36: ['oak_log', 2], 37: ['cobblestone', 3] } })
    const bot = craftBot(server); fakeWorld(bot, server); bot.findBlocks = () => []
    await server.sync()
    assert.equal(mod.townIngredientMiss(bot), true)
    assert.equal(townOrder({ now: 1e9, slots: 2, freeSlots: 34, junk: 0, distHome: 3, storageNear: true, composterAtTown: false, pickRoom: true,
      pickNeeded: true, pickMiss: () => true, ingredientMiss: () => mod.townIngredientMiss(bot), state: {} }).order, null)
    server.stop()
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
