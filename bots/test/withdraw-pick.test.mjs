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
const withServer = (w, serverBag = () => w.bot.inventory.items()) => {
  w.bot.craftSync = {
    lockstep: fn => fn(), recount: async () => ({ source: 'server', items: serverBag() }), inflight: () => 0,
    // the fake's window IS the server's: its cursor is the evidence (w.cursorEvidence may override, for a correction)
    confirmCursor: async win => { const c = w.cursorEvidence ? w.cursorEvidence(win) : win.selectedItem; return { answered: true, cursorEmpty: !c, carried: c ? { itemCount: c.count } : null } },
  }
  return w
}
const junk = n => Array.from({ length: n }, () => stack('bamboo', 64))
const { updateTownMemory, townKey } = await import('../src/chestfull.mjs')
const updateMem = fn => updateTownMemory(process.env.POOL_STATE_DIR, townKey({ x: 0, y: 64, z: 0 }), null, fn)

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
  // (round 1) the stone, not the logs: logs are a stone-pickaxe ingredient and stay; the reserve sits on the cobblestone
  const bag = [...junk(34), stack('cobblestone', 64), stack('stone', 20)]
  const w = withServer(town(bag, [tool('stone_pickaxe', 30)]))
  const before = total(w.bag)
  const r = await pick(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.match(r.detail, /banked 20x stone to make room/)
  assert.equal(count(w.bag, 'stone'), 0); assert.equal(count(w.bag, 'stone_pickaxe'), 1)
  assert.equal(total(w.bag), before - 20 + 1)
  assert.equal(w.containers.get('5,64,0').slots.filter(Boolean).reduce((n, s) => n + (s.name === 'stone' ? s.count : 0), 0), 20)
  assert.match(lastPickRow(), /deposited=stone:20/)
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
  assert.equal(townPickMiss(w.bot), true, 'its only container is a recent miss: complete coverage')
  const opened = w.spy.opened.length
  const r2 = await pick(w.bot)
  assert.equal(r2.status, 'no_effect', r2.detail)
  assert.equal(w.spy.opened.length, opened, 'no chest opened again: the miss is per container, and the ingredients are held')
})

await t('THE HOLD: what was withdrawn is not handed back by the next deposit (and is after the hold)', () => {
  clearWithdrawHolds()
  const bag = [stack('stick', 4), stack('cobblestone', 30), tool('stone_pickaxe', 30), tool('stone_pickaxe', 40)]
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

await t('a withdraw sets the hold: the copy it took is not banked beside the one the bag had', async () => {
  const w = withServer(town([tool('stone_pickaxe', 40), stack('cobblestone', 20)], [tool('stone_pickaxe', 30)]))
  const r = await withdraw(w.bot, { item: 'stone_pickaxe' })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'stone_pickaxe'), 2)
  assert.ok(!depositPlan(w.bot.inventory.items()).some(e => e.name === 'stone_pickaxe'), 'held')
  clearWithdrawHolds()
  assert.ok(depositPlan(w.bot.inventory.items()).some(e => e.name === 'stone_pickaxe'), 'control: without the hold a copy would bank')
})

// ---------------------------------------------------------------- the model's verb ---
await t('withdraw REQUIRES a named need: admission refuses it bare; the skill too', async () => {
  const w = withServer(town([], [stack('cobblestone', 64)]))
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

// ---------------------------------------------------------------- review round 1 (both engines) ---
const { allocate, roomCandidates, roomKeep, bagDelta } = W
const { containerPickMiss } = await import('../src/chestfull.mjs')
const { WITHDRAW_NO_BACKOFF } = W
const lastRowOf = verb => RECS.filter(r => r.skill?.name === '_withdraw_pick' && r.skill.detail.includes(`verb=${verb} `)).at(-1)?.skill?.detail ?? ''

await t('R1.1 CODEX REPRO: a full bag, a source slot filled with dirt mid-transfer -> the dirt goes into the CHEST, the cursor is empty before the close, nothing drops; unsettled', async () => {
  const w = withServer(town([...junk(35), stack('stick', 62)], [stack('stick', 40)]))
  const click = w.bot.clickWindow.bind(w.bot)
  let n = 0
  w.bot.clickWindow = async (slot, button, mode) => { n++; await click(slot, button, mode); if (n === 1) w.containers.get('5,64,0').slots[slot] = stack('dirt', 1) }
  const r = await withdraw(w.bot, { item: 'stick', count: 2 })
  assert.equal(w.dropped.length, 0, `dropped: ${JSON.stringify(w.dropped)}`)
  assert.equal(r.failClass, 'transfer_unsettled', r.detail)
  assert.ok(w.containers.get('5,64,0').slots.some(x => x?.name === 'dirt'), 'the dirt went into the chest, the only room left')
  assert.match(lastRowOf('withdraw'), /cursor=rescued/)
})

await t('R1.1 AN ABORT mid-transfer: the cursor is settled first, then the abort is rethrown', async () => {
  const w = withServer(town([], [stack('stick', 40)]))
  const ac = new AbortController()
  const click = w.bot.clickWindow.bind(w.bot)
  w.bot.clickWindow = async (slot, button, mode) => { await click(slot, button, mode); if (w.bot.currentWindow?.selectedItem) ac.abort() }
  let threw = null
  try { await SKILLS.withdraw.run({ bot: w.bot }, { item: 'stick', count: 5 }, ac.signal) } catch (e) { threw = e }
  assert.ok(threw, 'the abort propagates')
  assert.equal(w.dropped.length, 0); assert.equal(w.bot.currentWindow, null)
  assert.equal(total(w.bag) + w.containers.get('5,64,0').slots.filter(Boolean).reduce((k, x) => k + x.count, 0), 40, 'every stick accounted for')
})

await t('R1.1 THE PICKUP IS CHECKED: a cursor that does not hold the item stops the transfer', async () => {
  const w = withServer(town([], [stack('stick', 40)]))
  const click = w.bot.clickWindow.bind(w.bot)
  let n = 0
  w.bot.clickWindow = async (slot, button, mode) => { n++; if (n === 1) w.containers.get('5,64,0').slots[slot] = stack('dirt', 1); await click(slot, button, mode) }
  const r = await withdraw(w.bot, { item: 'stick', count: 2 })
  assert.equal(r.failClass, 'transfer_unsettled', r.detail)
  assert.match(lastRowOf('withdraw'), /err=picked_up_dirt/)
  assert.equal(count(w.bag, 'stick'), 0, 'no right-click happened with dirt on the cursor')
})

await t('R1.1 withdraw_pick ALWAYS writes its row: an exception is outcome=error', async () => {
  const w = withServer(town([], [tool('stone_pickaxe', 30)]))
  w.bot.findBlock = () => { throw new Error('world gone') }
  await assert.rejects(pick(w.bot))
  assert.match(lastPickRow(), /^outcome=error .*err=world_gone/)
})

await t('R1.2 ONE USABLE COPY ALWAYS STAYS, through the real deposit: [spent, spent, good] banks none; [good, good] banks one', async () => {
  const run = async bag => {
    const w = town(bag, [])
    const r = await SKILLS.deposit.run({ bot: w.bot }, {}, sig())
    return { w, r, inChest: w.containers.get('5,64,0').slots.filter(x => x?.name === 'stone_pickaxe') }
  }
  // the allowance itself (what admission, the prompt and the plan count), and then the transfer
  assert.ok(!depositPlan([tool('stone_pickaxe', 129), tool('stone_pickaxe', 125), tool('stone_pickaxe', 30)]).some(e => e.name === 'stone_pickaxe'), 'allowance 0')
  assert.equal(depositPlan([tool('stone_pickaxe', 30), tool('stone_pickaxe', 40)]).find(e => e.name === 'stone_pickaxe')?.count, 1, 'allowance 1')
  const a = await run([tool('stone_pickaxe', 129), tool('stone_pickaxe', 125), tool('stone_pickaxe', 30), stack('cobblestone', 30)])
  assert.equal(a.inChest.length, 0, 'no copy banked: two are spent and the good one is the last usable')
  assert.equal(a.w.bag.filter(x => x?.name === 'stone_pickaxe' && x.durabilityUsed === 30).length, 1)
  const b = await run([tool('stone_pickaxe', 30), tool('stone_pickaxe', 40), stack('cobblestone', 30)])
  assert.equal(b.inChest.length, 1, 'one of two good copies banks')
  assert.ok(hasUsablePick(b.w.bot.inventory.items()), 'and a usable one stays')
})

await t('R1.3 MAKE-ROOM IS CHEAPEST FIRST and keeps the goal\'s wants and the ingredients: never the iron', () => {
  const bag = [...junk(30), stack('iron_ingot', 3), stack('stone', 20), stack('cobblestone', 64), stack('cobblestone', 10), stack('oak_log', 20), stack('stick', 5)]
  const c = roomCandidates(bag, { keep: roomKeep([]) })
  assert.equal(c[0].name, 'stone', 'the cheapest bankable stack first')
  assert.ok(roomCandidates(bag).some(x => /cobblestone|oak_log/.test(x.name)), 'control: unkept, whole cobblestone and log stacks are candidates')
  assert.ok(!c.some(x => /stick|cobblestone|oak_log/.test(x.name)), 'ingredients are kept')
  assert.ok(!roomCandidates(bag, { keep: roomKeep(['iron_ingot']) }).some(x => x.name === 'iron_ingot'), 'a wanted item is kept')
  const onlyIron = [...junk(35), stack('iron_ingot', 3)]
  assert.equal(roomPlan(onlyIron, pickTakes(), { keep: roomKeep(['iron_ingot']) }).ok, false, 'the next craft\'s iron is never the room')
})

await t('R1.4 NO SERVER BASELINE (no craftsync): refused before any click, recount_unanswered, and no backoff', async () => {
  const w = town([stack('cobblestone', 20)], [tool('stone_pickaxe', 30)])   // no craftSync
  const r = await pick(w.bot)
  assert.equal(r.failClass, 'recount_unanswered', r.detail)
  assert.equal(w.spy.clicks.length, 0); assert.equal(count(w.bag, 'stone_pickaxe'), 0)
  assert.ok(WITHDRAW_NO_BACKOFF.has('recount_unanswered'))
  assert.equal(townOrderOutcome('withdraw_pick', 'failed', 1e9, {}, 'recount_unanswered').withdrawBackoffUntil, undefined)
})

await t('R1.5 CODEX REPRO: a spent replacement is not the copy taken -- before [30], after [30, 129], expected 30', () => {
  const v = transferVerdict({ before: [tool('stone_pickaxe', 30)], after: [tool('stone_pickaxe', 30), tool('stone_pickaxe', 129)], tool: { name: 'stone_pickaxe', used: 30 } })
  assert.equal(v.ok, false); assert.match(v.why, /gained \[129\]/)
  assert.equal(transferVerdict({ before: [tool('stone_pickaxe', 30)], after: [tool('stone_pickaxe', 30), tool('stone_pickaxe', 30)], tool: { name: 'stone_pickaxe', used: 30 } }).ok, true)
})

await t('R1.5 THE SOURCE IS REVALIDATED after the room-making click: a pickaxe swapped for a spent one is not taken', async () => {
  const w = withServer(town([...junk(34), stack('cobblestone', 64), stack('stone', 20)], [tool('stone_pickaxe', 30)]))
  const click = w.bot.clickWindow.bind(w.bot)
  let n = 0
  w.bot.clickWindow = async (slot, button, mode) => { n++; await click(slot, button, mode); if (n === 1) w.containers.get('5,64,0').slots[0] = tool('stone_pickaxe', 129) }
  const r = await pick(w.bot)
  assert.equal(r.failClass, 'transfer_unsettled', r.detail)
  assert.ok(!w.bag.some(x => x?.name === 'stone_pickaxe'), 'nothing taken')
})

await t('R1.6 CODEX REPRO: 36 slots, two 63-stick stacks, request 2 -> one each; plan and transfer agree', async () => {
  const bag = [...junk(34), stack('stick', 63), stack('stick', 63)]
  assert.deepEqual(allocate(bag.map((x, i) => ({ ...x, slot: i })), 'stick', 2, { emptySlots: 0 }), { partial: [{ slot: 34, n: 1 }, { slot: 35, n: 1 }], fresh: 0, leftover: 0 })
  const w = withServer(town(bag, [stack('stick', 40)]))
  const r = await withdraw(w.bot, { item: 'stick', count: 2 })
  assert.equal(r.status, 'success', r.detail); assert.equal(count(w.bag, 'stick'), 128)
})

await t('R1.7 MISSES PER CONTAINER: a container shown empty of pickaxes is skipped; the town-wide miss needs every container', async () => {
  const w = withServer(town([stack('crafting_table', 1), stack('cobblestone', 3), stack('stick', 2)], [stack('dirt', 5)]))
  w.set(-5, 64, 0, 'chest'); w.stock(-5, 64, 0, [tool('stone_pickaxe', 30)])
  updateMem(e => { e._pick_miss = { '5,64,0': Date.now() - 60_000 } })
  assert.equal(townPickMiss(w.bot), false, 'one of two containers missed: no town-wide miss')
  const r = await pick(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.ok(!w.spy.opened.includes('5,64,0'), 'the missed container was not opened')
  assert.equal(count(w.bag, 'stone_pickaxe'), 1)
})

await t('R1.7 A MISS ENDS WHEN THE CONTAINER TAKES ITEMS (stock changed)', () => {
  const now = Date.now()
  const e = { _pick_miss: { '1,2,3': now - 60_000 } }
  assert.equal(containerPickMiss(e, '1,2,3', now), true)
  e['1,2,3'] = { o: 'took', at: now - 1000, strikes: [] }
  assert.equal(containerPickMiss(e, '1,2,3', now), false)
})

await t('R1.8 A FULL CHEST AND A FULL BAG: the bag stack and the pickaxe TRADE PLACES in three clicks, verified', async () => {
  const chestStacks = [...Array.from({ length: 26 }, () => stack('cobblestone', 64)), tool('stone_pickaxe', 30)]
  const w = withServer(town([...junk(34), stack('cobblestone', 64), stack('stone', 20)], chestStacks))
  const r = await pick(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.match(r.detail, /traded 20x stone to make room/)
  assert.equal(count(w.bag, 'stone_pickaxe'), 1); assert.equal(count(w.bag, 'stone'), 0)
  assert.equal(w.containers.get('5,64,0').slots[26]?.name, 'stone', 'the stone took the pickaxe\'s slot')
  assert.equal(w.dropped.length, 0)
  assert.match(lastPickRow(), /chest_room=0 /)
})

await t('R1.8 A FULL CHEST for the ingredients: skipped as chest_no_room, no backoff', async () => {
  const chestStacks = [...Array.from({ length: 26 }, () => stack('cobblestone', 64)), stack('stick', 30)]
  const w = withServer(town([...junk(33), stack('cobblestone', 64), stack('stone', 20), stack('crafting_table', 1)], chestStacks))
  const r = await pick(w.bot)
  assert.equal(r.failClass, 'chest_no_room', r.detail)
  assert.equal(townOrderOutcome('withdraw_pick', 'failed', 1e9, {}, 'chest_no_room').withdrawBackoffUntil, undefined)
  assert.equal(w.spy.clicks.length, 0)
})

await t('R1.10 THE ROW: cursor, err, chest_room and the server-recounted change, from both verbs', async () => {
  const w = withServer(town([stack('stick', 3)], [stack('stick', 40), tool('stone_pickaxe', 30)]))
  await withdraw(w.bot, { item: 'stick', count: 2 })
  const row = lastRowOf('withdraw')
  assert.match(row, /^outcome=took need=stick:2 .*verification=server cursor=empty err=- chest_room=25 plan=- srv=stick:\+2 /)
  clearWithdrawHolds()
  const w2 = withServer(town([], [tool('stone_pickaxe', 30)]))
  await pick(w2.bot)
  assert.match(lastRowOf('withdraw_pick'), /srv=stone_pickaxe:\+1 /)
  assert.equal(bagDelta([stack('stick', 1)], [stack('stick', 3)]), 'stick:+2')
})

// ---------------------------------------------------------------- review round 2 ---
const fullChestWithPick = () => [...Array.from({ length: 26 }, () => stack('cobblestone', 64)), tool('stone_pickaxe', 30)]
const fullBag = () => [...junk(34), stack('cobblestone', 64), stack('stone', 20)]
const stopHold = bot => { try { bot.inventoryUnsettled?.stop?.() } catch {} }
const wait = ms => new Promise(r => setTimeout(r, ms))
/** Wrap the fake's clicks: `hook(n, slot, button, mode, w)` runs AFTER click n (1-based). */
const afterClick = (w, hook) => { const click = w.bot.clickWindow.bind(w.bot); let n = 0; w.bot.clickWindow = async (slot, button, mode) => { n++; await click(slot, button, mode); hook(n, slot, button, mode) } }

/** Every item in the bag, the chest and on the ground (the fake's drops) -- for "totals conserved". */
const everything = w => total(w.bag) + w.containers.get('5,64,0').slots.filter(Boolean).reduce((k, x) => k + x.count, 0) + w.dropped.reduce((k, x) => k + x.count, 0)
/** fullBag() with the stone moved from the hotbar (bag index 35) to the main inventory (index 0). */
const stoneInMain = () => { const b = fullBag(); return [b[35], ...b.slice(0, 35)] }
/** Record the cursor after every click: the trade must never load it. */
const watchCursor = w => { const seen = []; afterClick(w, () => seen.push(w.bot.currentWindow?.selectedItem?.name ?? null)); return seen }

await t('R7 THE TRADE, stack on the hotbar: ONE number-key swap (chest slot <-> hotbar 8); the cursor is never loaded; totals conserved', async () => {
  const w = withServer(town(fullBag(), fullChestWithPick()))
  const before = everything(w)
  const cursor = watchCursor(w)
  const r = await pick(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(w.spy.clicks, [[26, 8, 2]], 'one swap click')
  assert.deepEqual(cursor, [null], 'nothing carried')
  assert.equal(w.bag[35]?.name, 'stone_pickaxe'); assert.equal(w.containers.get('5,64,0').slots[26]?.name, 'stone')
  assert.equal(everything(w), before, 'totals conserved'); assert.equal(w.dropped.length, 0)
})

await t('R7 THE TRADE, stack in the main bag: bag<->hotbar swap, then chest<->hotbar swap; never the cursor; totals conserved', async () => {
  const w = withServer(town(stoneInMain(), fullChestWithPick()))
  const before = everything(w)
  const cursor = watchCursor(w)
  const r = await pick(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(w.spy.clicks, [[27, 8, 2], [26, 8, 2]], 'two swap clicks through hotbar 8')
  assert.deepEqual(cursor, [null, null], 'nothing carried, after either click')
  assert.equal(w.bag[35]?.name, 'stone_pickaxe'); assert.equal(w.containers.get('5,64,0').slots[26]?.name, 'stone')
  assert.equal(count(w.bag, 'stone'), 0); assert.equal(everything(w), before); assert.equal(w.dropped.length, 0)
})

await t('R7 AN AUTO-PICKUP INTO THE HOTBAR STACK between the swaps: the trade stops cleanly -- nothing carried, nothing dropped, no hold', async () => {
  const w = withServer(town(stoneInMain(), fullChestWithPick()))
  const before = everything(w)
  afterClick(w, n => { if (n === 1) w.bag[35].count += 3 })   // 3 stone picked up off the ground, merged into hotbar 8
  const r = await pick(w.bot)
  assert.equal(r.failClass, 'transfer_unsettled', r.detail)
  assert.match(r.detail, /did not reach hotbar 8/)
  assert.equal(w.spy.clicks.length, 1, 'no trade click')
  assert.equal(w.bot.inventoryUnsettled ?? null, null); assert.equal(w.bot.currentWindow, null); assert.equal(w.dropped.length, 0)
  assert.equal(everything(w), before + 3, 'only the picked-up 3 are new')
  assert.equal(w.containers.get('5,64,0').slots[26]?.name, 'stone_pickaxe', 'the pickaxe stayed')
})

await t('R7 A WHOLE SOURCE STACK of an ingredient goes by shift-click: no cursor at all', async () => {
  const w = withServer(town([], [stack('stick', 2)]))
  const cursor = watchCursor(w)
  const r = await withdraw(w.bot, { item: 'stick', count: 2 })
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(w.spy.clicks, [[0, 0, 1]]); assert.deepEqual(cursor, [null])
  assert.equal(count(w.bag, 'stick'), 2)
})

await t('R8 CODEX REPRO: a source refilled during the first click (2 -> 64) is not shift-clicked whole on its old count -- 10 taken, not 72', async () => {
  const w = withServer(town([], [stack('stick', 8), stack('stick', 2)]))
  afterClick(w, n => { if (n === 1) w.containers.get('5,64,0').slots[1] = stack('stick', 64) })   // refilled meanwhile
  const r = await withdraw(w.bot, { item: 'stick', count: 10 })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'stick'), 10, 'exactly the need')
  assert.equal(w.containers.get('5,64,0').slots[1]?.count, 62, 'the refilled stack gave 2, by the cursor path')
  assert.deepEqual(w.spy.clicks[0], [0, 0, 1], 'positive control: the 8 still went whole, by shift-click')
  assert.ok(!w.spy.clicks.slice(1).some(c => c[2] === 1), 'no shift-click on the refilled stack')
})

await t('R7 A PART of a stack: right-click picks up HALF; when that is exactly the need, ONE left-click places it -- 2 cursor clicks', async () => {
  const w = withServer(town([], [stack('stick', 8)]))
  const cursor = watchCursor(w)
  const r = await withdraw(w.bot, { item: 'stick', count: 4 })
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(w.spy.clicks.map(c => [c[1], c[2]]), [[1, 0], [0, 0]], 'half-pickup, one placement')
  assert.deepEqual(cursor, ['stick', null], 'loaded for exactly one click in between')
  assert.equal(count(w.bag, 'stick'), 4); assert.equal(w.containers.get('5,64,0').slots[0]?.count, 4)
})

await t('R7 A PART smaller than half: half on the cursor (not the whole stack), one at a time, the rest back', async () => {
  const w = withServer(town([], [stack('stick', 40)]))
  const peak = []
  afterClick(w, () => peak.push(w.bot.currentWindow?.selectedItem?.count ?? 0))
  const r = await withdraw(w.bot, { item: 'stick', count: 2 })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(Math.max(...peak), 20, 'at most HALF the stack was ever on the cursor (was 40)')
  assert.deepEqual(w.spy.clicks.map(c => c[1]), [1, 1, 1, 0], 'pickup half, two placements, the rest back')
  assert.equal(count(w.bag, 'stick'), 2); assert.equal(w.containers.get('5,64,0').slots[0]?.count, 38)
})

await t('R7 A HELD CURSOR (a part of a stack with nowhere to go) blocks admission: nothing else starts while the window is held', async () => {
  // withdraw stick 2: the right-click picks up 20 of 40; then the source is refilled with something else and an
  // auto-pickup fills the one empty bag slot -- the placement is refused and the 20 have nowhere to go.
  const w = withServer(town([...junk(34), stack('stick', 64)], [stack('stick', 40), ...Array.from({ length: 26 }, () => stack('cobblestone', 64))]))
  afterClick(w, n => { if (n === 1) { w.containers.get('5,64,0').slots[0] = stack('cobblestone', 64); w.bag[35] = stack('dirt', 64) } })
  const r = await withdraw(w.bot, { item: 'stick', count: 2 })
  assert.equal(r.failClass, 'transfer_unsettled', r.detail)
  assert.ok(w.bot.inventoryUnsettled && w.bot.currentWindow, 'positive control: held, never a loaded close')
  assert.equal(w.dropped.length, 0)
  const adm = new AdmissionControl().check({ skill: 'explore', args: {} }, w.bot)
  assert.equal(adm.ok, false); assert.equal(adm.reason, 'inventory_unsettled')
  stopHold(w.bot)
})

await t('R2.2 CODEX REPRO: a recovery click that stalls past the budget -- no loaded close, no late second click; the window closes once the cursor is empty', async () => {
  const w = withServer(town([...junk(35), stack('stick', 62)], [stack('stick', 40)]))
  const click = w.bot.clickWindow.bind(w.bot)
  let first = true, stalled = 0
  w.bot.clickWindow = async (slot, button, mode) => {
    if (button === 1 && slot >= 27 && first) { first = false; throw new Error('injected: the right-click failed') }
    // every click into the chest with a loaded cursor stalls 4.5 s: longer than the 3-s budget AND the 1-s retry tick
    if (slot < 27 && button === 0 && w.bot.currentWindow?.selectedItem && !first) { stalled++; await wait(4500) }
    return click(slot, button, mode)
  }
  const r = await withdraw(w.bot, { item: 'stick', count: 2 })
  assert.equal(r.failClass, 'transfer_unsettled', r.detail)
  assert.equal(w.dropped.length, 0, 'no close with 20 sticks on the cursor (the half picked up)')
  assert.ok(w.bot.inventoryUnsettled && w.bot.currentWindow, 'held open while the click is pending')
  await wait(3500)
  assert.equal(stalled, 1, 'no second click while the first is pending')
  assert.equal(w.bot.inventoryUnsettled ?? null, null, 'cleared once the cursor is empty')
  assert.equal(w.bot.currentWindow, null, 'and the window closed')
  assert.equal(w.dropped.length, 0)
  assert.equal(count(w.bag, 'stick') + w.containers.get('5,64,0').slots.filter(Boolean).reduce((k, x) => k + (x.name === 'stick' ? x.count : 0), 0), 102, 'every stick accounted for')
})

for (const [label, replace, expectOk] of [
  ['emptied', () => null, false],
  ['refilled with the same copy', () => tool('stone_pickaxe', 30), true],
  ['refilled with something else', () => stack('dirt', 1), false],
]) {
  await t(`R2.3 / 8 THE TRADE'S SOURCE CHANGES BETWEEN THE SWAPS (${label}): no trade click, nothing carried, nothing dropped`, async () => {
    const w = withServer(town(stoneInMain(), fullChestWithPick()))
    afterClick(w, n => { if (n === 1) w.containers.get('5,64,0').slots[26] = replace() })
    const r = await pick(w.bot)
    assert.equal(w.dropped.length, 0); assert.equal(w.bot.currentWindow, null); assert.equal(w.bot.inventoryUnsettled ?? null, null)
    if (expectOk) { assert.equal(r.status, 'success', r.detail); return }
    assert.equal(r.failClass, 'transfer_unsettled', r.detail)
    assert.equal(w.spy.clicks.length, 1, 'only the bag<->hotbar swap')
    assert.equal(count(w.bag, 'stone'), 20, 'the stone is still in the bag (on the hotbar now)')
    assert.ok(!w.containers.get('5,64,0').slots.some(x => x?.name === 'stone'), 'and not in the chest')
  })
}

await t('R2.4 CODEX REPRO: an ordinary deposit with wear [129, 30, 40] banks the WORST USABLE copy (40), never the spent one', async () => {
  const w = town([tool('stone_pickaxe', 129), tool('stone_pickaxe', 30), tool('stone_pickaxe', 40), stack('cobblestone', 30)], [])
  await SKILLS.deposit.run({ bot: w.bot }, {}, sig())
  const inChest = w.containers.get('5,64,0').slots.filter(x => x?.name === 'stone_pickaxe')
  assert.deepEqual(inChest.map(x => x.durabilityUsed), [40])
  assert.deepEqual(w.bag.filter(x => x?.name === 'stone_pickaxe').map(x => x.durabilityUsed).sort((a, b) => a - b), [30, 129])
})

await t('R2.5 / 6 AN ABORT AFTER THE PICKUP: the model verb writes its row, with THIS transfer\'s cursor and plan', async () => {
  const w = withServer(town([], [stack('stick', 40)]))
  const ac = new AbortController()
  afterClick(w, (n) => { if (n === 1) ac.abort() })
  await assert.rejects(SKILLS.withdraw.run({ bot: w.bot }, { item: 'stick', count: 5 }, ac.signal))
  const row = lastRowOf('withdraw')
  assert.match(row, /^outcome=aborted need=stick:5 /)
  assert.match(row, /cursor=rescued /)
  assert.equal(w.dropped.length, 0)
})

await t('R2.6 withdraw_pick\'s abort row reports the transfer that was aborted (plan, cursor), not an earlier visit', async () => {
  const w = withServer(town(stoneInMain(), fullChestWithPick()))   // two clicks: the abort lands between them
  const ac = new AbortController()
  afterClick(w, (n) => { if (n === 1) ac.abort() })
  await assert.rejects(SKILLS.withdraw_pick.run({ bot: w.bot }, {}, ac.signal))
  const row = lastPickRow()
  assert.match(row, /^outcome=aborted /)
  assert.match(row, /chest_room=0 plan=stone /)
  assert.match(row, /cursor=empty /, 'nothing was ever carried')
  assert.equal(w.dropped.length, 0); assert.equal(count(w.bag, 'stone'), 20)
})

await t('R2.7 the row names what was planned to leave the bag', async () => {
  const w = withServer(town(fullBag(), fullChestWithPick()))
  await pick(w.bot)
  assert.match(lastPickRow(), /plan=stone srv=/)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
