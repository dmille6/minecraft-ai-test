// TAKING THINGS OUT OF THE TOWN CHESTS (withdrawpick.mjs; skills.mjs withdraw / withdraw_pick). Behaviour only: the
// pure decisions by truth table, and both verbs driven through the real skill code against fakeworld.mjs, whose window
// plays vanilla's click modes.
//
// Facts it answers: 45/80 bots without a usable pickaxe beside chests holding 865 stone_pickaxe and 6,859 sticks;
// withdraw moved 48 items a day, the most plentiful when none was named, the first copy by slot.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-withdraw-logs-'))
process.env.BOT_NAME = 'PickBot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'   // the production watchdog: the runner sets 300 ms for tests, and withdraw is clamped to it
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-withdraw-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const W = await import('../src/withdrawpick.mjs')
const { bestToolCopy, stonePickDeficits, roomPlan, pickTakes, hasUsablePick, transferVerdict } = W
const { depositPlan, depositNoopReason, setWithdrawHold, clearWithdrawHolds } = await import('../src/bankable.mjs')
const { townOrder, townOrderOutcome } = await import('../src/composter.mjs')
const { SKILLS, townPickMiss } = await import('../src/skills.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { FLOOR } = await import('../src/toolfor.mjs')
const { fakeWorld, stack, tool, total } = await import('./fakeworld.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const lastPickRow = () => RECS.filter(r => r.skill?.name === '_withdraw_pick').at(-1)?.skill?.detail ?? ''
const sig = () => new AbortController().signal
const pick = (bot) => SKILLS.withdraw_pick.run({ bot }, {}, sig())
const withdraw = (bot, args) => SKILLS.withdraw.run({ bot }, args, sig())
const count = (bag, name) => bag.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
/** A town: the bot at 6.5,64,0.5 beside a chest at 5,64,0 holding `stacks`. */
const town = (bag, stacks) => { freshPool(); clearWithdrawHolds(); const w = fakeWorld({ bag }); w.set(5, 64, 0, 'chest'); w.stock(5, 64, 0, stacks); return w }
/** A craftsync stand-in: lockstep runs the clicks; recount answers with `serverBag()` (the truth unless a test says otherwise). */
const withServer = (w, serverBag = () => w.bot.inventory.items()) => { w.bot.craftSync = { lockstep: fn => fn(), recount: async () => ({ source: 'server', items: serverBag() }) }; return w }
const junk = n => Array.from({ length: n }, () => stack('bamboo', 64))

// ---------------------------------------------------------------- which copy ---
await t('bestToolCopy: never a spent copy; a trip\'s worth of uses first, then tier, then uses left', () => {
  const p = (name, used, slot) => ({ ...tool(name, used), slot })
  assert.equal(bestToolCopy([p('stone_pickaxe', 131 - FLOOR, 0)]), null, 'at FLOOR uses: spent, never taken')
  assert.equal(bestToolCopy([p('stone_pickaxe', 131 - FLOOR - 1, 0)])?.slot, 0, 'one use above FLOOR: usable')
  assert.equal(bestToolCopy([p('stone_pickaxe', 10, 0), p('iron_pickaxe', 10, 1)]).name, 'iron_pickaxe', 'iron over stone')
  assert.equal(bestToolCopy([p('stone_pickaxe', 100, 0), p('stone_pickaxe', 20, 1)]).slot, 1, 'more uses left')
  assert.equal(bestToolCopy([p('iron_pickaxe', 230, 0), p('stone_pickaxe', 20, 1)]).name, 'stone_pickaxe', 'a 111-use stone over a 20-use iron: a trip\'s worth first')
  assert.equal(bestToolCopy([p('wooden_pickaxe', 0, 0), p('stone_pickaxe', 0, 1)]).name, 'stone_pickaxe')
  assert.equal(hasUsablePick([tool('stone_pickaxe', 125)]), false); assert.equal(hasUsablePick([tool('stone_pickaxe', 100)]), true)
})

await t('PREFER_USES is oretunnel.mjs MIN_TRIP_USES (restated to avoid an import cycle)', async () => {
  const { MIN_TRIP_USES } = await import('../src/oretunnel.mjs')
  assert.equal(W.PREFER_USES, MIN_TRIP_USES)
})

await t('stonePickDeficits: exact -- 3 cobblestone, 2 sticks, and 4 planks only when no table is carried or in reach', () => {
  assert.deepEqual(stonePickDeficits([]), [{ need: 'cobblestone', count: 3 }, { need: 'stick', count: 2 }, { need: 'planks', count: 4 }])
  assert.deepEqual(stonePickDeficits([], { tableNear: true }), [{ need: 'cobblestone', count: 3 }, { need: 'stick', count: 2 }])
  assert.deepEqual(stonePickDeficits([stack('crafting_table', 1), stack('cobblestone', 1), stack('stick', 5)]), [{ need: 'cobblestone', count: 2 }])
  assert.deepEqual(stonePickDeficits([stack('cobbled_deepslate', 3), stack('stick', 2), stack('oak_log', 1)]), [], 'variants count; a log is 4 planks')
  assert.deepEqual(stonePickDeficits([stack('birch_planks', 2), stack('cobblestone', 3), stack('stick', 2)]), [{ need: 'planks', count: 2 }])
})

// ---------------------------------------------------------------- room ---
await t('roomPlan: an empty slot is enough; at 36/36 only a WHOLE stack deposit would bank is moved; junk and tools never', () => {
  assert.deepEqual(roomPlan([stack('bamboo', 64)], pickTakes()), { ok: true, need: 1, empty: 35, deposit: [] })
  const full = [...junk(34), { ...stack('cobblestone', 64), slot: 40 }, { ...stack('oak_log', 20), slot: 41 }]
  const r = roomPlan(full, pickTakes())
  assert.equal(r.ok, true); assert.deepEqual(r.deposit, [{ name: 'oak_log', count: 20, slot: 41 }], 'the logs (the cobblestone keeps the scaffold reserve)')
  assert.equal(roomPlan([...junk(35), tool('stone_axe', 3)], pickTakes()).ok, false, 'nothing deposit would bank: no room, no order')
  const sticks = [...junk(35), stack('stick', 10)]
  assert.equal(roomPlan(sticks, [{ name: 'stick', count: 2 }]).ok, true, 'a partial stack takes the sticks: no slot needed')
  assert.equal(roomPlan(sticks, [{ name: 'stick', count: 2 }]).deposit.length, 0)
  assert.equal(roomPlan([...junk(35), stack('oak_log', 20)], [{ name: 'oak_log', count: 4 }]).deposit.length, 0, 'never banks what it is taking')
  assert.equal(roomPlan([...junk(35), stack('cobblestone', 64)], pickTakes()).ok, false, 'deposit would bank 56 of the 64 (the scaffold reserve): the stack would not empty')
  assert.equal(roomPlan([...junk(34), tool('stone_axe', 3), tool('stone_axe', 5)], pickTakes()).ok, false, 'a spare tool copy is never moved to make room')
  const logs = [...junk(34), stack('cobblestone', 64), stack('oak_log', 20)]   // the reserve is spent on the cobblestone
  assert.equal(roomPlan(logs, [{ name: 'stick', count: 2 }], { keep: ['oak_log'] }).ok, false, 'a kept ingredient is never moved')
  assert.equal(roomPlan(logs, [{ name: 'stick', count: 2 }]).ok, true, 'control: the same logs, not kept, make the room')
})

// ---------------------------------------------------------------- the town order ---
await t('townOrder: withdraw_pick only at town, with no usable pickaxe, no recent miss and room; compost first; cooldown on issue; backoff on failure', () => {
  const base = { now: 1e9, slots: 20, freeSlots: 16, junk: 0, distHome: 5, storageNear: true, composterAtTown: true, pickNeeded: true, pickMiss: false, pickRoom: true, state: {} }
  const r = townOrder(base)
  assert.equal(r.order?.skill, 'withdraw_pick')
  assert.equal(townOrder({ ...base, distHome: 200 }).order, null, 'never a trip')
  assert.equal(townOrder({ ...base, pickNeeded: false }).order, null)
  assert.equal(townOrder({ ...base, pickMiss: true }).order, null, 'the town found none recently')
  assert.equal(townOrder({ ...base, pickRoom: false }).order, null, 'no room can be made: no order')
  assert.equal(townOrder({ ...base, slots: 36, freeSlots: 0, junk: 40 }).order?.skill, 'compost', 'compost frees slots first')
  assert.equal(townOrder({ ...base, now: 1e9 + 60_000, state: r.state }).order, null, 'cooldown charged on issue')
  const s = townOrderOutcome('withdraw_pick', 'failed', 1e9, r.state, 'container_short')
  assert.ok(s.withdrawBackoffUntil > 1e9)
  assert.equal(townOrder({ ...base, now: 1e9 + 6 * 60_000, state: s }).order, null, 'backed off')
})

// ---------------------------------------------------------------- the pickaxe, end to end ---
await t('withdraw_pick takes the BEST USABLE copy, never the spent ones, verified by the server; nothing dropped', async () => {
  const w = withServer(town([stack('cobblestone', 20)], [tool('stone_pickaxe', 128), tool('stone_pickaxe', 30), tool('wooden_pickaxe', 0), tool('stone_pickaxe', 125)]))
  const r = await pick(w.bot)
  assert.equal(r.status, 'success', r.detail)
  const got = w.bag.filter(it => it?.name?.endsWith('_pickaxe'))
  assert.equal(got.length, 1); assert.equal(got[0].name, 'stone_pickaxe'); assert.equal(got[0].durabilityUsed, 30)
  assert.equal(w.dropped.length, 0); assert.equal(w.bot.currentWindow, null)
  assert.ok(w.spy.clicks.some(([, , mode]) => mode === 1), 'a shift-click')
  assert.match(lastPickRow(), /^outcome=took_pick need=pickaxe uses=101 verification=server /)
})

await t('SERVER VERIFICATION: a transfer the server reverted is transfer_unsettled, never a success', async () => {
  const w = town([stack('cobblestone', 20)], [tool('stone_pickaxe', 30)])
  const before = w.bot.inventory.items().map(it => ({ ...it }))
  withServer(w, () => before)            // the server's bag never changed
  const r = await pick(w.bot)
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'transfer_unsettled', r.detail)
  assert.match(lastPickRow(), /verification=server/)
})

await t('AT 36/36: a whole bankable stack is deposited in the same window, then the pickaxe taken -- items conserved', async () => {
  const bag = [...junk(34), stack('cobblestone', 64), stack('oak_log', 20)]
  const w = withServer(town(bag, [tool('stone_pickaxe', 30)]))
  const before = total(w.bag)
  const r = await pick(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.match(r.detail, /banked 20x oak_log to make room/)
  assert.equal(count(w.bag, 'oak_log'), 0); assert.equal(count(w.bag, 'stone_pickaxe'), 1)
  assert.equal(total(w.bag), before - 20 + 1)
  assert.equal(w.containers.get('5,64,0').slots.filter(Boolean).reduce((n, s) => n + (s.name === 'oak_log' ? s.count : 0), 0), 20)
  assert.match(lastPickRow(), /deposited=oak_log:20/)
})

await t('AT 36/36 WITH NOTHING BANKABLE: no order is issued, and a forced visit moves nothing', async () => {
  const bag = [...junk(35), tool('stone_axe', 3)]
  assert.equal(roomPlan(bag, pickTakes()).ok, false)
  const w = withServer(town(bag, [tool('stone_pickaxe', 30)]))
  const r = await pick(w.bot)
  assert.equal(r.failClass, 'inventory_full', r.detail)
  assert.doesNotMatch(r.detail, /deposit or drop/)
  assert.equal(count(w.bag, 'stone_pickaxe'), 0); assert.equal(w.spy.clicks.length, 0, 'not one click')
})

await t('NO PICKAXE IN TOWN: the exact ingredients come out, the miss is remembered, and the next order walks nowhere', async () => {
  const w = withServer(town([stack('crafting_table', 1), stack('stick', 1)],
    [stack('cobblestone', 64), stack('stick', 30), stack('oak_planks', 40), tool('stone_pickaxe', 127)]))
  const r = await pick(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'cobblestone'), 3); assert.equal(count(w.bag, 'stick'), 2); assert.equal(count(w.bag, 'oak_planks'), 0, 'a table is carried: no planks')
  assert.equal(count(w.bag, 'stone_pickaxe'), 0, 'the spent copy stays in the chest')
  const chest = w.containers.get('5,64,0').slots.filter(Boolean)
  assert.equal(chest.find(s => s.name === 'cobblestone').count, 61, 'the rest went back')
  assert.equal(chest.find(s => s.name === 'stick').count, 29)
  assert.equal(w.dropped.length, 0); assert.equal(w.bot.currentWindow, null)
  assert.match(lastPickRow(), /^outcome=took_ingredients need=cobblestone:3,stick:1 /)
  assert.equal(townPickMiss(w.bot), true)
  const opened = w.spy.opened.length
  const r2 = await pick(w.bot)
  assert.equal(r2.status, 'no_effect'); assert.match(r2.detail, /last 15 min/)
  assert.equal(w.spy.opened.length, opened, 'no chest opened again')
})

await t('THE HOLD: what was withdrawn is not handed back by the next deposit (and is after the hold)', () => {
  clearWithdrawHolds()
  const bag = [stack('stick', 4), stack('cobblestone', 30), tool('stone_pickaxe', 30), tool('stone_pickaxe', 128)]
  assert.ok(depositPlan(bag).some(e => e.name === 'stick'), 'control: without a hold the sticks bank')
  assert.ok(depositPlan(bag).some(e => e.name === 'stone_pickaxe'), 'control: a second pickaxe copy banks')
  setWithdrawHold('stick', 2, Date.now() + 60_000)
  setWithdrawHold('stone_pickaxe', 1, Date.now() + 60_000)
  assert.ok(!depositPlan(bag).some(e => e.name === 'stick'))
  assert.ok(!depositPlan(bag).some(e => e.name === 'stone_pickaxe'))
  assert.match(String(depositNoopReason(bag, 'stick')), /just withdrawn/)
  clearWithdrawHolds()
  setWithdrawHold('stick', 2, Date.now() - 1)   // (the reserve keeps 2 of the 4; the hold the other 2)
  assert.ok(depositPlan(bag).some(e => e.name === 'stick'), 'an expired hold is gone')
  clearWithdrawHolds()
})

await t('the withdraw_pick sets the hold: the good copy it took is not banked beside the spent one it had', async () => {
  const w = withServer(town([tool('stone_pickaxe', 129), stack('cobblestone', 20)], [tool('stone_pickaxe', 30)]))
  const r = await pick(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'stone_pickaxe'), 2)
  assert.ok(!depositPlan(w.bot.inventory.items()).some(e => e.name === 'stone_pickaxe'), 'held')
  clearWithdrawHolds()
  assert.ok(depositPlan(w.bot.inventory.items()).some(e => e.name === 'stone_pickaxe'), 'control: without the hold a copy would bank')
})

// ---------------------------------------------------------------- the model's verb ---
await t('withdraw REQUIRES a named need: admission refuses it bare; the skill too', async () => {
  const w = town([], [stack('cobblestone', 64)])
  const a = new AdmissionControl().check({ skill: 'withdraw', args: {} }, w.bot)
  assert.equal(a.ok, false); assert.equal(a.reason, 'withdraw_needs_item')
  const r = await withdraw(w.bot, {})
  assert.equal(r.status, 'failed'); assert.equal(count(w.bag, 'cobblestone'), 0, 'the most plentiful item is not taken')
})

await t('withdraw stick 2: exactly two, by single clicks into one slot, the rest back; withdraw stone_pickaxe: the best usable copy', async () => {
  const w = withServer(town([stack('stick', 3)], [stack('stick', 40), tool('stone_pickaxe', 129), tool('stone_pickaxe', 60)]))
  const r = await withdraw(w.bot, { item: 'stick', count: 2 })
  assert.equal(r.status, 'success', r.detail); assert.equal(count(w.bag, 'stick'), 5)
  assert.equal(w.bag.filter(it => it?.name === 'stick').length, 1, 'merged into the partial stack')
  const r2 = await withdraw(w.bot, { item: 'stone_pickaxe' })
  assert.equal(r2.status, 'success', r2.detail)
  assert.equal(w.bag.find(it => it?.name === 'stone_pickaxe').durabilityUsed, 60)
  assert.equal(w.dropped.length, 0)
})

await t('a named tool with ONLY spent copies is container_short (no vote), and nothing moves', async () => {
  const w = withServer(town([], [tool('stone_pickaxe', 129), tool('stone_pickaxe', 125)]))
  const r = await withdraw(w.bot, { item: 'stone_pickaxe' })
  assert.equal(r.failClass, 'container_short', r.detail)
  assert.doesNotMatch(r.detail, /no .* within/, 'not the nothing_found prose')
  assert.equal(count(w.bag, 'stone_pickaxe'), 0)
})

await t('NEVER DROPS: a remainder that cannot go back to its slot is returned to the bag, and the verdict says unsettled', async () => {
  const w = withServer(town([], [stack('stick', 40)]))
  // another player fills the source slot while the stack is on the cursor: the put-back swaps instead of emptying
  const click = w.bot.clickWindow.bind(w.bot)
  let n = 0
  w.bot.clickWindow = async (slot, button, mode) => {
    n++
    await click(slot, button, mode)
    if (n === 1) w.containers.get('5,64,0').slots[slot] = stack('dirt', 1)
  }
  const r = await withdraw(w.bot, { item: 'stick', count: 2 })
  assert.equal(w.dropped.length, 0, 'nothing on the ground')
  assert.equal(w.bot.currentWindow, null)
  assert.equal(r.failClass, 'transfer_unsettled', r.detail)
})

await t('transferVerdict: exact gains and losses; the tool by name and wear', () => {
  const b = [stack('stick', 1)], a = [stack('stick', 3), tool('stone_pickaxe', 30)]
  assert.equal(transferVerdict({ before: b, after: a, took: { stick: 2 }, tool: { name: 'stone_pickaxe', used: 30 } }).ok, true)
  assert.equal(transferVerdict({ before: b, after: a, took: { stick: 3 } }).ok, false)
  assert.equal(transferVerdict({ before: b, after: a, tool: { name: 'stone_pickaxe', used: 31 } }).ok, false, 'another copy')
  assert.equal(transferVerdict({ before: [stack('oak_log', 20)], after: [], gave: { oak_log: 20 } }).ok, true)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
