// BAMBOO -> STICKS (bamboo.mjs + skills.mjs bamboo_sticks). The pure decisions on the worked cases both engines agreed,
// then the order through skills.mjs -> craftroom's executor -> REAL craftsync -> mineflayer 4.37.1's craft.js and
// inventory.js -> the fake Paper (helpers/fake-paper-craft.mjs), whose slots are the oracle.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-bamboo-'))
process.env.SKILL_TIMEOUT_MS = '180000'   // the craft deadline is the skill timeout; the suite's 300 ms leaves none
const B = await import('../src/bamboo.mjs')
const CS = await import('../src/craftsync.mjs')
const { FakePaper, craftBot, learnAll, registry, Item } = await import('./helpers/fake-paper-craft.mjs')
const { SKILLS, SKILL_CONTRACTS } = await import('../src/skills.mjs')
const { evidenceScope } = await import('../src/cognitive.mjs')
const { isHousekeeping } = await import('../src/hygiene.mjs')
const { createRequire } = await import('node:module')
const { Recipe } = createRequire(import.meta.url)('prismarine-recipe')('1.21.8')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const S = (name, count) => ({ name, count })
const fill = (n, name = 'cobblestone') => Array.from({ length: n }, () => S(name, 64))

// ------------------------------------------------------------------ bambooPlan: the worked cases
await t('bamboo [64] + sticks [32] at 36/36 -> 32 crafts free 1 slot (the bamboo stack empties, the sticks top up to 64)', () => {
  const p = B.bambooPlan([S('bamboo', 64), S('stick', 32), ...fill(34)])
  assert.deepEqual([p.crafts, p.freed, p.after], [32, 1, 35])
})
await t('bamboo [64] with NO sticks -> nothing frees (the bamboo slot becomes the sticks\' slot): do nothing', () => {
  const p = B.bambooPlan([S('bamboo', 64), ...fill(35)])
  assert.deepEqual([p.crafts, p.freed], [0, 0]); assert.match(p.why, /no batch .* frees a slot/)
})
await t('bamboo [64,64] with no sticks -> 64 crafts free 1, but need a temporary slot: refused at 36/36, planned at 35/36', () => {
  const full = B.bambooPlan([S('bamboo', 64), S('bamboo', 64), ...fill(34)])
  assert.equal(full.crafts, 0); assert.match(full.why, /64 craft\(s\) would free a slot but need 1 more slot/)
  const roomy = B.bambooPlan([S('bamboo', 64), S('bamboo', 64), ...fill(33)])
  assert.deepEqual([roomy.crafts, roomy.freed, roomy.peak], [64, 1, 36])
})
await t('bamboo [63] + sticks [32] -> 31 crafts leave 1 bamboo: frees 0; an odd remainder never empties a stack', () => {
  assert.deepEqual([B.bambooPlan([S('bamboo', 63), S('stick', 32), ...fill(34)]).crafts], [0])
  assert.equal(B.bambooPlan([S('bamboo', 1), S('stick', 10), ...fill(34)]).crafts, 0, 'one bamboo makes nothing')
})
await t('the SMALLEST batch that frees a slot: bamboo [10] + sticks [32] -> 5 crafts', () => {
  const p = B.bambooPlan([S('bamboo', 10), S('stick', 32), ...fill(34)])
  assert.deepEqual([p.crafts, p.freed], [5, 1])
})
await t('STICK CAP: never past 64 sticks -- bamboo [64] + sticks [40] would need 32 crafts (72 sticks): nothing', () => {
  const p = B.bambooPlan([S('bamboo', 64), S('stick', 40), ...fill(34)])
  assert.equal(p.crafts, 0)
  assert.equal(B.bambooPlan([S('bamboo', 64), S('stick', 64), ...fill(34)]).crafts, 0, 'already at the cap')
  // where the cap ALONE decides: two partial stick stacks (40 + 30) take all 32 sticks, so an uncapped fold frees the
  // bamboo slot -- but 70 sticks are already past the cap
  const two = [S('bamboo', 64), S('stick', 40), S('stick', 30), ...fill(33)]
  assert.equal(B.bambooPlan(two).crafts, 0, 'folded past the 64-stick cap')
  const uncapped = B.bambooPlan(two, { stickCap: 1000 })
  assert.deepEqual([uncapped.crafts, uncapped.freed], [32, 1], 'positive control: without the cap the same bag would fold')
})
await t('BELOW 34 SLOTS nothing is planned, whatever the bamboo', () => {
  assert.equal(B.bambooPlan([S('bamboo', 64), S('stick', 32), ...fill(31)]).crafts, 0)
  assert.equal(B.bambooPlan([S('bamboo', 64), S('stick', 32), ...fill(32)]).crafts, 32, 'positive control: at 34 it is')
})

// ------------------------------------------------------------------ the recipe and the order
await t('bambooStickRecipe picks the bamboo recipe -- never a planks one -- from the 13 real 1.21.8 stick recipes', () => {
  const rs = Recipe.find(registry.itemsByName.stick.id)
  assert.equal(rs.length, 13)
  const r = B.bambooStickRecipe(rs, registry)
  assert.deepEqual(r.delta.filter(d => d.count < 0).map(d => [registry.items[d.id].name, -d.count]), [['bamboo', 2]])
  assert.notEqual(rs[0], r, 'positive control: the first stick recipe is NOT the bamboo one')
  assert.equal(B.bambooStickRecipe(rs.filter(x => x !== r), registry), null)
})
await t('bambooOrder: issued at 34+ with a freeing batch; never below 34, inside the cooldown, or in a backoff; the cooldown is charged when issued', () => {
  const NOW = 1e9
  const bag = [S('bamboo', 64), S('stick', 32), ...fill(34)]
  const o = B.bambooOrder({ items: bag, now: NOW })
  assert.equal(o.order?.skill, 'bamboo_sticks'); assert.equal(o.lastAt, NOW)
  assert.equal(B.bambooOrder({ items: [S('bamboo', 64), S('stick', 32), ...fill(31)], now: NOW }).order, null, 'below 34')
  assert.equal(B.bambooOrder({ items: bag, now: NOW, lastAt: NOW - B.BAMBOO_COOLDOWN_MS + 1 }).order, null, 'cooldown')
  assert.equal(B.bambooOrder({ items: bag, now: NOW, backoffUntil: NOW + 1 }).order, null, 'backoff')
  assert.equal(B.bambooOrderOutcome('failed', NOW), NOW + B.BAMBOO_BACKOFF_MS)
  for (const s of ['success', 'no_effect', 'aborted']) assert.equal(B.bambooOrderOutcome(s, NOW), 0, s)
})
await t('registered chatOnly, housekeeping, with a loss contract; its failure classes never vote', () => {
  assert.equal(SKILLS.bamboo_sticks?.chatOnly, true); assert.ok(isHousekeeping('bamboo_sticks'))
  assert.deepEqual(SKILL_CONTRACTS.bamboo_sticks.expects, ['inventory_loss'])
  for (const fc of ['bamboo_no_room', 'bamboo_craft']) assert.equal(evidenceScope(fc), null, fc)
})

await t('WIRED (structural): cognitive.mjs issues the order right after wear_out and before the town orders, and backs a failure off', () => {
  const src = fs.readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const wear = src.indexOf("order = { skill: 'wear_out'"), bamboo = src.indexOf('const r = bambooOrder({ items: this.bot.inventory'), town = src.indexOf('const r = townOrder({')
  assert.ok(wear > 0 && bamboo > wear && town > bamboo, `order: wear_out@${wear} bamboo@${bamboo} town@${town}`)
  assert.match(src.slice(bamboo, town), /if \(r\.order\) order = r\.order/)
  assert.match(src, /if \(admitted\.skill === 'bamboo_sticks'\) this\.bambooBackoffUntil = bambooOrderOutcome\(r\.status, Date\.now\(\)\)/)
})

// ------------------------------------------------------------------ through REAL craftsync + fake Paper
const nameOf = it => registry.items[it.type].name
function bag (stacks, used, filler = 'dirt') {
  const inv = { ...stacks }
  for (let s = 9; s <= 44 && Object.keys(inv).length < used; s++) if (!inv[s]) inv[s] = [filler, 64]
  return inv
}
async function setup (inv) {
  const server = new FakePaper({ lagClicks: 3, fallbackMs: 60, inventory: inv })
  const bot = craftBot(server)
  bot.entities = {}; bot.health = 20; bot.food = 20
  await server.sync()
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r) })
  learnAll(bot, server, ['stick'])
  return { server, bot, rows }
}
const fold = async (bot, server) => {
  const out = await SKILLS.bamboo_sticks.run({ bot }, {}, new AbortController().signal)
  await server.settle(); server.stop()
  return out
}
const craftClicks = server => server.writes.filter(w => w.name === 'window_click' && w.params.stateId !== -1).length
const used = server => server.p.slice(9, 45).filter(Boolean).length
const LOG = () => path.join(process.env.LOG_DIR, `skill-${process.env.BOT_NAME ?? 'TestBot'}.jsonl`)
const rowsOf = kind => {
  try { return fs.readFileSync(fs.readdirSync(process.env.LOG_DIR).map(f => path.join(process.env.LOG_DIR, f)).find(f => /^skill-/.test(path.basename(f))) ?? LOG(), 'utf8')
    .trim().split('\n').map(l => JSON.parse(l)).filter(r => r.skill?.name === kind) } catch { return [] }
}

await t('PLANKS UNTOUCHED: bamboo [64] + sticks [32] + oak_planks [10] at 36/36 -> 32 crafts verified by the server, 1 slot freed, planks 10 -> 10', async () => {
  const { server, bot, rows } = await setup(bag({ 36: ['bamboo', 64], 37: ['stick', 32], 38: ['oak_planks', 10] }, 36))
  assert.equal(used(server), 36)
  const out = await fold(bot, server)
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual([server.count('bamboo'), server.count('stick'), server.count('oak_planks')], [0, 64, 10])
  assert.equal(used(server), 35, 'no slot freed'); assert.deepEqual(server.dropped, [])
  assert.ok(rows.length === 32 && rows.every(r => r.args.confirmed === 'yes'), `${rows.length} craftsync rows`)
  await new Promise(r => setTimeout(r, 100))
  const row = rowsOf('_bamboo_sticks').at(-1)?.skill?.detail ?? ''
  assert.match(row, /^bamboo=64->0 sticks=32->64 planks=10->10 slots=36->35 crafts=32\/32 freed=1/, row)
})

await t('REFUSED AT 36/36 when the output needs a new slot (bamboo [64,64], no sticks): no click, nothing spent', async () => {
  const { server, bot } = await setup(bag({ 36: ['bamboo', 64], 37: ['bamboo', 64] }, 36))
  const out = await fold(bot, server)
  assert.equal(out.status, 'no_effect', out.detail); assert.match(out.detail, /need 1 more slot/)
  assert.equal(craftClicks(server), 0); assert.equal(server.count('bamboo'), 128); assert.deepEqual(server.dropped, [])
})

await t('STICK CAP through the skill: bamboo [64] + sticks [40] at 36/36 -> nothing crafted', async () => {
  const { server, bot } = await setup(bag({ 36: ['bamboo', 64], 37: ['stick', 40] }, 36))
  const out = await fold(bot, server)
  assert.equal(out.status, 'no_effect'); assert.equal(craftClicks(server), 0); assert.equal(server.count('stick'), 40)
})

await t('THE CHAIN WITH A PICKUP RACE: at 35/36 the first stick needs the last slot; pickups fill it during craftsync\'s baseline -> admission refuses: bamboo_no_room, nothing dropped', async () => {
  const { server, bot, rows } = await setup(bag({ 36: ['bamboo', 64], 37: ['bamboo', 64] }, 35))
  const receive = server.receive.bind(server)
  let fired = false
  server.receive = (name, params) => {
    if (!fired && name === 'close_window' && params.windowId === 0) {
      fired = true
      for (let s = 9; s <= 44; s++) {
        if (server.p[s]) continue
        server.p[s] = new Item(registry.itemsByName.dirt.id, 64); server.sid[0]++
        server.send([['set_slot', { windowId: 0, stateId: server.sid[0], slot: s, item: Item.toNotch(server.p[s]) }]])
      }
    }
    return receive(name, params)
  }
  const out = await fold(bot, server)
  assert.ok(fired, 'the pickup never happened')
  assert.equal(out.status, 'failed'); assert.equal(out.failClass, 'bamboo_no_room', out.detail)
  assert.equal(evidenceScope(out.failClass), null)
  assert.equal(craftClicks(server), 0, 'a craft click went out after the admission refused')
  assert.deepEqual(server.dropped, []); assert.equal(server.count('bamboo'), 128); assert.equal(server.count('stick'), 0)
  assert.deepEqual(rows.map(r => [r.args.outcome, r.args.stop]), [['refused', 'admission: no_room_after_resync']])
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
