// THREE DEPOSIT/CRAFT DEFECTS FROM THE CODEX TRIAGE (28-29 Sep), each driven through the real code:
//   deposit's chest walk ignored cancellation; a named deposit was admitted on the whole inventory's total;
//   craft walked to a table before finding out it could not make the thing.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-banktriage'
process.env.BOT_NAME = 'TestBot'
const { SKILLS, walkCancellable } = await import('../src/skills.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { createRequire } = await import('node:module')
const registry = createRequire(import.meta.url)('prismarine-registry')('1.21.8')
const { Vec3 } = createRequire(import.meta.url)('vec3')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

// A pathfinder shaped like mineflayer-pathfinder 2.4.5: goto() never resolves on its own here, and setGoal()
// emits goal_updated, which rejects the pending goto with GoalChanged (lib/goto.js:34).
function walkerBot () {
  const bot = new EventEmitter()
  bot.entity = { position: { x: 0, y: 64, z: 0 } }
  bot.inventory = { items: () => [] }
  bot.pathfinder = {
    goto: goal => new Promise((_, rej) => {
      const onGoal = g => { if (g !== goal) { bot.removeListener('goal_updated', onGoal); rej(Object.assign(new Error('The goal was changed before it could be completed!'), { name: 'GoalChanged' })) } }
      bot.on('goal_updated', onGoal)
    }),
    setGoal: g => bot.emit('goal_updated', g, false),
    stop () {},
  }
  return bot
}

await t('a cancelled deposit walk lets go at once (it held the runner ~210 s), and says how long it took', async () => {
  const bot = walkerBot(); const ac = new AbortController()
  const t0 = Date.now()
  setTimeout(() => ac.abort(), 30)
  await assert.rejects(walkCancellable(bot, { x: 5 }, 60_000, ac.signal, 'deposit'), e => e.aborted === true)
  assert.ok(Date.now() - t0 < 1000, `let go after ${Date.now() - t0} ms`)
})
await t('POSITIVE CONTROL: with no cancel the same walk runs to its deadline, and that is NOT an abort', async () => {
  const bot = walkerBot(); const ac = new AbortController()
  await assert.rejects(walkCancellable(bot, { x: 5 }, 80, ac.signal, 'deposit'), e => !e.aborted)
})
await t('an already-cancelled skill never starts the walk', async () => {
  const bot = walkerBot(); const ac = new AbortController(); ac.abort()
  let started = false; const goto = bot.pathfinder.goto; bot.pathfinder.goto = g => { started = true; return goto(g) }
  await assert.rejects(walkCancellable(bot, { x: 5 }, 60_000, ac.signal, 'deposit'), e => e.aborted === true)
  assert.equal(started, false)
})

// ---- admission: the named item is judged by the plan execution will run ----
function gateBot (inv) {
  return { registry, entity: { position: { x: 5, y: 64, z: 5 } },
           inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id })) },
           findBlock: () => ({ position: { x: 6, y: 64, z: 6 }, type: 1 }) }
}
const gate = () => new AdmissionControl({ failCount: () => 0, bumpBlocked () {}, entryFor: () => null })
await t('deposit apple (not a banking target) is refused BEFORE the walk, with the reason execution would give', async () => {
  const r = gate().check({ skill: 'deposit', args: { item: 'apple' } }, gateBot({ apple: 5, cobblestone: 200, oak_log: 40 }))
  assert.equal(r.ok, false); assert.equal(r.reason, 'deposit_nothing_to_bank'); assert.match(r.detail, /not a banking target/)
})
await t('POSITIVE CONTROL: deposit diamond is not refused for that reason; a bare deposit is not either', async () => {
  const bot = gateBot({ apple: 5, diamond: 3 })
  assert.notEqual(gate().check({ skill: 'deposit', args: { item: 'diamond' } }, bot).reason, 'deposit_nothing_to_bank')
  assert.notEqual(gate().check({ skill: 'deposit', args: {} }, bot).reason, 'deposit_nothing_to_bank')
})

// ---- craft: no walk to the table when no table recipe is makeable from what is carried ----
const ID = { oak_planks: 1, stick: 2, wooden_pickaxe: 3, crafting_table: 4 }
const NAME = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k]))
const PICK = { result: { id: 3, count: 1 }, delta: [{ id: 1, count: -3 }, { id: 2, count: -2 }, { id: 3, count: 1 }], requiresTable: true }
function craftBot (bag, tableAt = new Vec3(20, 64, 0)) {
  const walks = []
  const met = (r, table) => (!r.requiresTable || table) && r.delta.every(d => d.count >= 0 || (bag[NAME[d.id]] ?? 0) >= -d.count)
  const bot = {
    registry: { itemsByName: Object.fromEntries(Object.entries(ID).map(([n, id]) => [n, { id, name: n }])),
                items: Object.fromEntries(Object.entries(ID).map(([n, id]) => [id, { id, name: n }])),
                blocks: { 99: { name: 'crafting_table' } } },
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => Object.entries(bag).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count })) },
    recipesFor: (id, _m, _n, table) => (NAME[id] === 'wooden_pickaxe' && met(PICK, table)) ? [PICK] : [],
    recipesAll: (id, _m, table) => (NAME[id] === 'wooden_pickaxe' && (!PICK.requiresTable || table)) ? [PICK] : [],
    craft: async () => { bag.wooden_pickaxe = (bag.wooden_pickaxe ?? 0) + 1 },
    findBlock: ({ matching }) => (tableAt && matching({ type: 99 }) ? { position: tableAt, type: 99 } : null),
    blockAt: () => null, lookAt: async () => {},
    pathfinder: { goto: async g => { walks.push(g); bot.entity.position = new Vec3(g.x - 1, g.y, g.z) }, setGoal () {}, stop () {} },
  }
  return { bot, walks }
}
await t('craft wooden_pickaxe holding NO sticks: no walk to the table 20 blocks away; the gap is named', async () => {
  const { bot, walks } = craftBot({ oak_planks: 3 })
  const r = await SKILLS.craft.run({ bot }, { item: 'wooden_pickaxe', count: 1 }, new AbortController().signal, 3)
  assert.equal(walks.length, 0, `walked ${walks.length} time(s)`)
  assert.notEqual(r.status, 'success'); assert.match(r.detail, /stick/)
})
await t('POSITIVE CONTROL: holding the ingredients, it DOES walk to the table and crafts', async () => {
  const { bot, walks } = craftBot({ oak_planks: 3, stick: 2 })
  const r = await SKILLS.craft.run({ bot }, { item: 'wooden_pickaxe', count: 1 }, new AbortController().signal, 3)
  assert.ok(walks.length >= 1, 'it walked to the table'); assert.equal(r.status, 'success', r.detail)
})

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
await t('WIRED: deposit\'s chest walk goes through walkCancellable', () => {
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.match(sk, /await walkCancellable\(bot, new goals\.GoalNear\(chestBlock\.position\.x, chestBlock\.position\.y, chestBlock\.position\.z, 2\),\s*DEPOSIT_WALK_MS, signal, 'deposit'\)/)
  assert.doesNotMatch(sk, /await bot\.pathfinder\.goto\(new goals\.GoalNear\(chestBlock\.position/, 'the unbounded walk is gone')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
