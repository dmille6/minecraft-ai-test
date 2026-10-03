// CRAFTROOM ON CRAFTSYNC, end to end: skills.mjs's craft -> the room check -> craftsync.mjs -> mineflayer 4.37.1's
// REAL craft.js and inventory.js -> the fake Paper (helpers/fake-paper-craft.mjs). The SERVER's slots are the oracle.
//
// Two claims, each with its positive control:
//   1. The combined path never crafts into a full bag. Control: the same bag handed straight to craftsync loses the
//      pickaxe on the ground (craftsync DETECTS the loss, it cannot prevent it -- its put-away keeps mineflayer's toss).
//   2. It never double-counts produced items. One bot.craft per execution, each verified by craftsync, and the skill's
//      `produced` (and the runner's `crafted`) is the root item's server delta exactly -- not twice it, not the planks.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Vec3 } from 'vec3'
import * as CS from '../src/craftsync.mjs'
import { FakePaper, craftBot, learnAll, fakeWorld, recipeFor, registry, Item } from './helpers/fake-paper-craft.mjs'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-test-craftroom-sync-'))
process.env.SKILL_TIMEOUT_MS = '180000'   // the craft deadline is the runner's timeout; the suite's 300 ms leaves none
const { SKILLS } = await import('../src/skills.mjs')
const { Runner } = await import('../src/runner.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

/** `stacks` at the given slots, `free` slots left empty, every other bag slot (9..44) a FULL stack of dirt. */
const fullBag = (stacks, free = 0) => {
  const inv = { ...stacks }
  let left = free
  for (let s = 9; s <= 44; s++) {
    if (inv[s]) continue
    if (left > 0) { left--; continue }
    inv[s] = ['dirt', 64]
  }
  return inv
}
const used = inv => Object.keys(inv).length
const NEXT_TO = '1,64,0'
const nameOf = it => registry.items[it.type].name

async function setup (inv, { table = NEXT_TO } = {}) {
  const server = new FakePaper({ lagClicks: 3, fallbackMs: 60, inventory: inv })
  const bot = craftBot(server)
  const placed = fakeWorld(bot, server)
  if (table) placed.set(table, 'crafting_table')
  await server.sync()
  const rows = []
  CS.installCraftSync(bot, { log: r => rows.push(r) })
  learnAll(bot, server, ['wooden_pickaxe', 'stone_pickaxe', 'stick', 'crafting_table', 'oak_planks'])
  return { server, bot, rows }
}
const skill = async (bot, server, item, count) => {
  const out = await SKILLS.craft.run({ bot }, { item, count }, new AbortController().signal)
  await server.settle(); server.stop()
  return out
}
const viaRunner = async (bot, server, item, count) => {
  Object.assign(bot, { health: 20, food: 20, chat () {} })
  // the runner's perception asks findBlock by id list; this flat world only answers the skill's predicate
  const find = bot.findBlock
  bot.findBlock = o => (typeof o?.matching === 'function' ? find(o) : null)
  const r = await new Runner(bot).run('craft', { item, count })
  await server.settle(); server.stop()
  return r
}
const clicks = server => server.writes.filter(w => w.name === 'window_click').length
/** Craft clicks only: craftsync's resync is a no-op click outside the window (slot -999, stateId -1). */
const craftClicks = server => server.writes.filter(w => w.name === 'window_click' && w.params.stateId !== -1).length
/**
 * THE SERVER'S AUTO-PICKUP, at a moment of the test's choosing: when the client sends a packet `when` matches, a full
 * stack of dirt lands in the first empty bag slot and the server says so (set_slot), exactly as a collected item does.
 */
function pickupOn (server, when, { viaOpenWindow = false } = {}) {
  const receive = server.receive.bind(server)
  let done = false
  server.receive = (name, params) => {
    if (!done && when(name, params)) {
      const slot = server.p.findIndex((it, i) => i >= 9 && i <= 44 && !it)
      if (slot >= 0) {
        done = true
        server.p[slot] = new Item(registry.itemsByName.dirt.id, 64)
        // viaOpenWindow: announced through the open crafting window (its bag region is window-0 slot + 1), as a
        // server syncs the player's slots while a container menu is open; otherwise through window 0
        const w = viaOpenWindow && server.tableId != null ? server.tableId : 0
        server.sid[w]++
        server.send([['set_slot', { windowId: w, stateId: server.sid[w], slot: w === 0 ? slot : slot + 1, item: Item.toNotch(server.p[slot]) }]])
      }
    }
    return receive(name, params)
  }
  return () => done
}
// The baseline resync begins with craftsync's close_window(0); a pickup then is inside the resync's flight.
const duringBaseline = (name, params) => name === 'close_window' && params.windowId === 0

// ------------------------------------------------------------------ 1. never into a full bag
await t('POSITIVE CONTROL: the same full bag handed straight to craftsync -> the pickaxe is on the ground; craftsync only reports it', async () => {
  const inv = fullBag({ 36: ['stick', 5], 37: ['cobblestone', 10] })
  assert.equal(used(inv), 36)
  const { server, bot } = await setup(inv)
  const recipe = recipeFor(bot, server, 'stone_pickaxe', true)
  await assert.rejects(bot.craft(recipe, 1, { position: new Vec3(1, 64, 0), name: 'crafting_table' }, { deadline: Date.now() + 60_000 }),
    e => e.failClass === 'craft_unconfirmed')
  await server.settle(); server.stop()
  assert.deepEqual(server.dropped.map(nameOf), ['stone_pickaxe'], 'the instrument cannot see a toss')
  assert.equal(server.count('stone_pickaxe'), 0)
})

await t('COMBINED: the same full bag through the skill -> inventory_full, nothing clicked, nothing dropped, nothing spent', async () => {
  const inv = fullBag({ 36: ['stick', 5], 37: ['cobblestone', 10] })
  const { server, bot, rows } = await setup(inv)
  const out = await skill(bot, server, 'stone_pickaxe', 1)
  assert.equal(out.failClass, 'inventory_full', out.detail)
  assert.equal(clicks(server), 0, 'a window click went out: bot.craft ran')
  assert.deepEqual(server.dropped, []); assert.equal(rows.length, 0, 'craftsync was entered')
  assert.deepEqual([server.count('stick'), server.count('cobblestone'), server.count('stone_pickaxe')], [5, 10, 0])
})

await t('COMBINED: a full bag whose cobblestone stack the recipe empties -> the pickaxe takes that slot, verified by craftsync', async () => {
  const inv = fullBag({ 36: ['stick', 5], 37: ['cobblestone', 3] })
  const { server, bot, rows } = await setup(inv)
  const out = await skill(bot, server, 'stone_pickaxe', 1)
  assert.equal(out.status, 'success', out.detail)
  assert.deepEqual(server.dropped, []); assert.equal(server.count('stone_pickaxe'), 1)
  assert.deepEqual([out.produced, out.verification], [1, 'server'])
  assert.deepEqual(rows.map(r => r.args.confirmed), ['yes'])
})

await t('COMBINED PLAN: the bag fills mid-tree -> the stick step refuses, nothing dropped, the verified planks stay', async () => {
  // 35 slots used: the plank executions fit (the second joins the first stack); the sticks would need a 37th slot
  const inv = fullBag({ 36: ['oak_log', 3] }, 1)
  assert.equal(used(inv), 35)
  const { server, bot } = await setup(inv)
  const out = await skill(bot, server, 'wooden_pickaxe', 1)
  assert.equal(out.failClass, 'inventory_full', out.detail); assert.match(out.detail, /making stick for wooden_pickaxe/)
  assert.deepEqual(server.dropped, [])
  assert.deepEqual([server.count('oak_planks'), server.count('stick'), server.count('wooden_pickaxe')], [8, 0, 0])
})

// ------------------------------------------------------------------ 1b. the pickup race (Codex, both reviews: P1)
// 35 slots, 5 sticks, 10 cobblestone: the room check before bot.craft says yes. A pickup lands while craftsync's
// baseline resync is in flight; the result now has no slot.
const RACE = () => fullBag({ 36: ['stick', 5], 37: ['cobblestone', 10] }, 1)

await t('RACE, POSITIVE CONTROL: without admission the pickup during the baseline resync costs the pickaxe (dropped, none kept)', async () => {
  assert.equal(used(RACE()), 35)
  const { server, bot } = await setup(RACE())
  const landed = pickupOn(server, duringBaseline)
  const recipe = recipeFor(bot, server, 'stone_pickaxe', true)
  await assert.rejects(bot.craft(recipe, 1, { position: new Vec3(1, 64, 0), name: 'crafting_table' }, { deadline: Date.now() + 60_000 }),
    e => e.failClass === 'craft_unconfirmed')
  await server.settle(); server.stop()
  assert.ok(landed(), 'the pickup never happened')
  assert.deepEqual(server.dropped.map(nameOf), ['stone_pickaxe'])
  assert.equal(server.count('stone_pickaxe'), 0)
})

await t('RACE through the skill: craftsync admits AFTER its resync -> refused, no craft click, nothing dropped, nothing spent', async () => {
  const { server, bot, rows } = await setup(RACE())
  const landed = pickupOn(server, duringBaseline)
  const out = await skill(bot, server, 'stone_pickaxe', 1)
  assert.ok(landed(), 'the pickup never happened')
  assert.equal(out.failClass, 'inventory_full', out.detail)
  assert.match(out.detail, /filled while craftsync resynced it/)
  assert.equal(craftClicks(server), 0, 'a craft click went out after the admission refused')
  assert.ok(clicks(server) >= 1, 'positive control: the baseline resync itself did go out')
  assert.deepEqual(server.dropped, [])
  assert.deepEqual([server.count('stick'), server.count('cobblestone'), server.count('stone_pickaxe')], [5, 10, 0])
  assert.deepEqual(rows.map(r => [r.args.outcome, r.args.stop]), [['refused', 'admission: no_room_after_resync']])
})

await t('LIMIT, documented: a pickup landing AFTER the clicks began (on the result click) still costs the pickaxe -- craftsync detects it, nothing can undo it', async () => {
  // Admission passed (35/36, no item in range). The pickup lands as the result is taken and the server announces it
  // through the open crafting window; mineflayer's put-away then finds no slot and throws the pickaxe. craftsync's
  // verification sees the count did not rise: craft_unconfirmed, not_in_inventory. (Announced through window 0 instead,
  // the client's table view does not learn of it, put-away swaps the pickaxe into the "empty" slot and the DIRT is
  // dropped on close -- the pickaxe survives. Which a real Paper does is not established here.)
  const { server, bot } = await setup(RACE())
  const landed = pickupOn(server, (name, params) => name === 'window_click' && params.windowId !== 0 && params.slot === 0, { viaOpenWindow: true })
  const out = await skill(bot, server, 'stone_pickaxe', 1)
  assert.ok(landed(), 'the pickup never happened')
  assert.equal(out.failClass, 'craft_unconfirmed', out.detail)
  assert.match(out.detail, /did not reach the inventory/, 'a server-confirmed absence is said as such')
  assert.deepEqual([out.executions, out.produced], [0, 0], 'nothing credited')
  assert.deepEqual(server.dropped.map(nameOf), ['stone_pickaxe'])
})

// ------------------------------------------------------------------ 2. never double-counted
await t('NO DOUBLE COUNT: 8 sticks is two verified executions; produced 8 = the server delta; the runner says +8', async () => {
  const { server, bot, rows } = await setup({ 36: ['oak_planks', 4], 9: ['dirt', 64] }, { table: null })
  const r = await viaRunner(bot, server, 'stick', 8)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(server.count('stick'), 8)
  assert.deepEqual(rows.map(x => [x.args.count, x.args.produced, x.args.confirmed]), [[1, 4, 'yes'], [1, 4, 'yes']])
  assert.match((r.contractEvidence ?? []).join(';'), /crafted: stick \+8 /, (r.contractEvidence ?? []).join(';'))
})

await t('NO DOUBLE COUNT, PLAN: a wooden_pickaxe from logs credits +1; the planks and sticks craftsync verified are not added', async () => {
  const { server, bot, rows } = await setup({ 36: ['oak_log', 3], 9: ['dirt', 64] })
  const r = await viaRunner(bot, server, 'wooden_pickaxe', 1)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(server.count('wooden_pickaxe'), 1)
  assert.deepEqual(rows.map(x => x.args.item), ['oak_planks', 'oak_planks', 'stick', 'wooden_pickaxe'], 'one craftsync row per execution')
  assert.ok(rows.every(x => x.args.confirmed === 'yes'))
  const ev = (r.contractEvidence ?? []).join(';')
  assert.match(ev, /crafted: wooden_pickaxe \+1 /, ev)
  assert.doesNotMatch(ev, /oak_planks|stick/, 'sub-steps leaked into the evidence')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
