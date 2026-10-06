// withdraw2 (owner 10-06): BEST-FIRST pickaxe withdrawal and the IRON UPGRADE. Behaviour only: the pure decisions by
// truth table, and withdraw_pick driven through the real skill code against fakeworld.mjs (vanilla click modes), with
// the craft skill substituted where the fake world cannot craft.
//
// Facts it answers: 13 pickaxes withdrawn live in 6 h, 7 of them WOODEN (bestToolCopy ranked ">= 40 uses" above tier
// and the order took at the first container with any usable copy); 105 iron_pickaxe crafts failed "short iron_ingot"
// in 72 h while the banks held ~806 ingots.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-withdraw2-logs-'))
process.env.BOT_NAME = 'Pick2Bot'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
const freshPool = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-withdraw2-pool-')); process.env.POOL_STATE_DIR = d; return d }
freshPool()

const W = await import('../src/withdrawpick.mjs')
const { depositPlan, bankableExclusion, setWithdrawHold, withdrawHolds, releaseWithdrawHold, clearWithdrawHolds } = await import('../src/bankable.mjs')
const { townOrder } = await import('../src/composter.mjs')
const { SKILLS, townBetterPickMiss, townIronRuledOut, withdrawIronState } = await import('../src/skills.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, tool, total } = await import('./fakeworld.mjs')
const { updateTownMemory, townKey } = await import('../src/chestfull.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.stack?.split('\n').slice(0, 3).join('\n        ')}`) }
}
const RECS = []
tapRecords(r => RECS.push(r))
const lastRow = () => RECS.filter(r => r.skill?.name === '_withdraw_pick').at(-1)?.skill ?? {}
const sig = () => new AbortController().signal
const pick = bot => SKILLS.withdraw_pick.run({ bot }, {}, sig())
const count = (bag, name) => bag.filter(Boolean).reduce((n, it) => n + (it.name === name ? it.count : 0), 0)
const town = (bag, stacks) => { freshPool(); clearWithdrawHolds(); withdrawIronState.at = -Infinity; const w = fakeWorld({ bag }); w.set(5, 64, 0, 'chest'); w.stock(5, 64, 0, stacks); return w }
const withServer = w => {
  w.bot.craftSync = {
    lockstep: fn => fn(), recount: async () => ({ source: 'server', items: w.bot.inventory.items() }), inflight: () => 0,
    confirmCursor: async win => { const c = win.selectedItem; return { answered: true, cursorEmpty: !c, carried: c ? { itemCount: c.count } : null } },
  }
  return w
}
const updateMem = fn => updateTownMemory(process.env.POOL_STATE_DIR, townKey({ x: 0, y: 64, z: 0 }), null, fn)
const readMem = async () => (await import('../src/chestfull.mjs')).readTownMemory(process.env.POOL_STATE_DIR, townKey({ x: 0, y: 64, z: 0 }), null)
const p = (name, used, slot = 0) => ({ ...tool(name, used, name.startsWith('diamond') ? 1561 : name.startsWith('netherite') ? 2031 : undefined), slot })
const everything = (w, keys = ['5,64,0', '-5,64,0']) => total(w.bag) + keys.reduce((k, key) => k + (w.containers.get(key)?.slots ?? []).filter(Boolean).reduce((a, x) => a + x.count, 0), 0) + w.dropped.reduce((k, x) => k + x.count, 0)
/** The craft skill, substituted: `honest` consumes 3 ingots + 2 sticks and adds an iron pickaxe; `liar` says success and
 *  changes nothing; `fails` refuses. The real skill is restored after each test. */
const realCraft = SKILLS.craft.run
const craftStub = (w, mode) => {
  const calls = []
  SKILLS.craft.run = async (_ctx, args) => {
    calls.push(args)
    if (mode === 'fails') return { status: 'failed', failClass: 'not_craftable', detail: 'missing ingredients or need a crafting_table nearby' }
    if (mode === 'honest' || mode === 'abortAfter' || mode === 'honestLosesDiamonds') {
      const take = (name, n) => { for (const it of w.bag) { if (!it || it.name !== name || n <= 0) continue; const k = Math.min(n, it.count); it.count -= k; n -= k } for (let i = 0; i < w.bag.length; i++) if (w.bag[i] && w.bag[i].count <= 0) w.bag[i] = null }
      take('iron_ingot', 3); take('stick', 2)
      const i = w.bag.findIndex(x => !x); if (i >= 0) w.bag[i] = tool('iron_pickaxe', 0); else w.bag.push(tool('iron_pickaxe', 0))
      if (mode === 'honestLosesDiamonds') take('diamond', 8)   // an unrelated loss during the craft
      if (mode === 'abortAfter') throw Object.assign(new Error('aborted during the table retake'), { aborted: true })
    }
    return { status: 'success', produced: 1, requested: 1, verification: 'server', detail: 'crafted 1x iron_pickaxe' }
  }
  return calls
}

// ---------------------------------------------------------------- pure ---
await t('RANK: tier first (netherite > diamond > iron > stone > golden > wooden), then uses left; never a spent copy', () => {
  const r = W.rankCopies([p('wooden_pickaxe', 0, 0), p('iron_pickaxe', 230, 1), p('stone_pickaxe', 0, 2), p('golden_pickaxe', 0, 3), p('diamond_pickaxe', 1500, 4), p('iron_pickaxe', 100, 5)])
  assert.deepEqual(r.map(c => `${c.name}:${c.slot}`), ['diamond_pickaxe:4', 'iron_pickaxe:5', 'iron_pickaxe:1', 'stone_pickaxe:2', 'golden_pickaxe:3', 'wooden_pickaxe:0'])
  assert.equal(W.bestToolCopy([p('iron_pickaxe', 245, 0), p('wooden_pickaxe', 0, 1)]).name, 'wooden_pickaxe', 'a spent iron (5 left) is never taken')
  assert.equal(W.bestToolCopy([p('netherite_pickaxe', 0, 0), p('diamond_pickaxe', 0, 1)]).name, 'netherite_pickaxe')
})

await t('TIERS: the bag\'s best USABLE pickaxe tier; spent ones do not count', () => {
  assert.equal(W.heldPickTier([]), -1)
  assert.equal(W.heldPickTier([p('wooden_pickaxe', 0), p('stone_pickaxe', 125)]), W.heldPickTier([p('wooden_pickaxe', 0)]), 'a 6-use stone is spent')
  assert.equal(W.tierName(W.heldPickTier([p('stone_pickaxe', 0), p('iron_pickaxe', 0)])), 'iron')
})

await t('NO-BETTER EVIDENCE: complete coverage, <= held, fresh, cleared by a later deposit', () => {
  const now = 1e12, e = {}
  W.notePickBest(e, ['a'], 2, now - 1000)   // stone at best
  W.notePickBest(e, ['b'], -1, now - 1000)  // none
  assert.equal(W.townBetterPickRuledOut(e, ['a', 'b'], 2, now), true, 'nothing better than stone anywhere')
  assert.equal(W.townBetterPickRuledOut(e, ['a', 'b'], 0, now), false, 'a holds stone: better than wooden')
  assert.equal(W.townBetterPickRuledOut(e, ['a', 'b', 'c'], 2, now), false, 'c never looked in')
  assert.equal(W.townBetterPickRuledOut(e, ['a', 'b'], 2, now + W.PICK_BEST_TTL_MS), false, 'expired')
  e.b = { o: 'took', at: now - 10 }
  assert.equal(W.townBetterPickRuledOut(e, ['a', 'b'], 2, now), false, 'a deposit into b since')
})

await t('INGOT EVIDENCE: quantities sum across containers; a double chest counts once; ruled out only below the deficit', () => {
  const now = 1e12, e = {}
  W.noteIngotsSeen(e, ['a', 'a2'], 2, now - 1000)   // a double chest: 2 on its first key, 0 on the other half
  W.noteIngotsSeen(e, ['b'], 1, now - 1000)
  assert.equal(W.townIngotsRuledOut(e, ['a', 'a2', 'b'], 3, now), false, '2 + 1 = 3: possible across two chests')
  assert.equal(W.townIngotsRuledOut(e, ['a', 'a2', 'b'], 4, now), true, 'below the deficit')
  assert.equal(W.townIngotsRuledOut(e, ['a', 'a2', 'b', 'c'], 4, now), false, 'incomplete coverage')
  assert.equal(W.townIngotsRuledOut(e, ['a', 'a2', 'b'], 0, now), false, 'nothing needed is never "ruled out"')
})

await t('IRON PLAN: <= 2 take visits, prerequisites first, ingots LAST; split ingots, no wood or no plan -> nothing', () => {
  const C = (key, ...saw) => ({ key, saw })
  const one = W.ironPlan([], [C('A', stack('iron_ingot', 5), stack('stick', 9))], { tableNear: true })
  assert.deepEqual(one.steps, [{ key: 'A', takes: [{ name: 'stick', count: 2 }, { name: 'iron_ingot', count: 3 }] }])
  const two = W.ironPlan([], [C('B', stack('iron_ingot', 3)), C('A', stack('stick', 9))], { tableNear: true })
  assert.deepEqual(two.steps.map(s => s.key), ['A', 'B'], 'the prerequisites\' container first')
  assert.deepEqual(two.steps[1].takes, [{ name: 'iron_ingot', count: 3 }])
  assert.equal(W.ironPlan([], [C('A', stack('iron_ingot', 2), stack('stick', 9)), C('B', stack('iron_ingot', 1))], { tableNear: true }).ok, false, 'ingots split 2 + 1: no single container')
  assert.equal(W.ironPlan([], [C('A', stack('iron_ingot', 5))], { tableNear: true }).ok, false, 'no sticks or wood anywhere')
  assert.deepEqual(W.ironPlan([], [C('A', stack('iron_ingot', 5), stack('oak_planks', 9))], { tableNear: true }).steps[0].takes, [{ name: 'oak_planks', count: 2 }, { name: 'iron_ingot', count: 3 }], 'planks for the sticks')
  assert.deepEqual(W.ironPlan([], [C('A', stack('iron_ingot', 5), stack('oak_log', 9))], { tableNear: false }).steps[0].takes, [{ name: 'oak_log', count: 2 }, { name: 'iron_ingot', count: 3 }], 'no table: 4 + 2 planks = 2 logs')
  assert.deepEqual(W.ironPlan([stack('iron_ingot', 1), stack('stick', 2)], [C('A', stack('iron_ingot', 5))], { tableNear: true }).steps, [{ key: 'A', takes: [{ name: 'iron_ingot', count: 2 }] }], 'only the deficit')
  assert.deepEqual(W.ironPlan([stack('iron_ingot', 3), stack('stick', 2)], [], { tableNear: true }), { ok: true, why: null, steps: [] }, 'all held: craft only')
})

await t('DEPOSIT KEEPS AN IRON PICKAXE\'S INGOTS while the best usable pickaxe is below iron; releaseWithdrawHold gives a hold back', () => {
  clearWithdrawHolds()
  const below = [p('stone_pickaxe', 0), stack('iron_ingot', 5)]
  assert.equal(depositPlan(below).find(d => d.name === 'iron_ingot')?.count, 2, '3 of 5 kept')
  assert.equal(bankableExclusion([p('stone_pickaxe', 0), stack('iron_ingot', 3)], 'iron_ingot'), 'iron_upgrade_reserve')
  assert.equal(depositPlan([p('iron_pickaxe', 0), stack('iron_ingot', 5)]).find(d => d.name === 'iron_ingot')?.count, 5, 'an iron holder banks them all')
  setWithdrawHold('stick', 2, Date.now() + 60_000); releaseWithdrawHold('stick', 2)
  assert.equal(withdrawHolds().stick ?? 0, 0)
})

await t('THE GATE: an upgrade order needs a pickaxe below iron, its 30-min cooldown, and EITHER branch still possible', () => {
  const base = { now: 1e9, slots: 20, freeSlots: 16, junk: 0, distHome: 5, storageNear: true, composterAtTown: true, pickNeeded: false, upgradeNeeded: true, state: {} }
  assert.equal(townOrder({ ...base, betterMiss: false, ironMiss: true }).order?.skill, 'withdraw_pick', 'a better copy may exist')
  assert.equal(townOrder({ ...base, betterMiss: true, ironMiss: false }).order?.skill, 'withdraw_pick', 'an iron one may be made')
  assert.equal(townOrder({ ...base, betterMiss: true, ironMiss: true }).order, null, 'both ruled out: no order')
  assert.equal(townOrder({ ...base, upgradeNeeded: false, betterMiss: false, ironMiss: false }).order, null, 'iron or better held: never')
  const r = townOrder({ ...base, betterMiss: false })
  assert.equal(townOrder({ ...base, betterMiss: false, now: 1e9 + 29 * 60_000, state: { ...r.state, lastScanAt: 0 } }).order, null, 'once per 30 min')
  assert.equal(townOrder({ ...base, betterMiss: false, now: 1e9 + 31 * 60_000, state: { ...r.state, lastScanAt: 0 } }).order?.skill, 'withdraw_pick')
  const none = { ...base, pickNeeded: true, upgradeNeeded: false, pickRoom: true, pickMiss: true, ingredientMiss: true }
  assert.equal(townOrder({ ...none, ironMiss: false }).order?.skill, 'withdraw_pick', 'no pickaxe, no stone ingredients, but iron possible: an order')
  assert.equal(townOrder({ ...none }).order, null, 'iron ruled out too (the default): none')
})

// ---------------------------------------------------------------- behaviour ---
await t('BEST-FIRST ACROSS CHESTS: a fresh wooden in the nearest chest, a worn iron in the next -- the IRON is taken (inspect, then take)', async () => {
  const w = withServer(town([], [p('wooden_pickaxe', 0)]))
  w.set(-5, 64, 0, 'chest'); w.stock(-5, 64, 0, [p('iron_pickaxe', 200)])
  const r = await pick(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'iron_pickaxe'), 1); assert.equal(count(w.bag, 'wooden_pickaxe'), 0)
  assert.deepEqual(w.spy.opened, ['5,64,0', '-5,64,0', '-5,64,0'], 'both inspected, then the winner revisited')
  const a = lastRow().args
  assert.equal(a.took_tier, 'iron'); assert.equal(a.best_seen, 'iron'); assert.equal(a.best_valid, 'iron'); assert.equal(a.complete, true)
  assert.equal(a.took_uses, 50, 'the taken copy\'s uses left are in args (G2 reads them)')
})

await t('FALLBACK: the iron is GONE at the take (another bot) -- re-ranked, the next best still standing is taken, and the row says so', async () => {
  const w = withServer(town([], [p('wooden_pickaxe', 0), p('stone_pickaxe', 0)]))
  w.set(-5, 64, 0, 'chest'); w.stock(-5, 64, 0, [p('iron_pickaxe', 200)])
  const open = w.bot.openContainer
  let n = 0
  w.bot.openContainer = async b => { if (++n === 3) w.containers.get('-5,64,0').slots[0] = null; return open(b) }   // gone before the revisit
  const r = await pick(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'stone_pickaxe'), 1, 'the stone, not the wooden')
  const a = lastRow().args
  assert.equal(a.took_tier, 'stone'); assert.equal(a.best_seen, 'iron'); assert.equal(a.best_valid, 'stone', 'the iron was proven gone')
  assert.deepEqual(a.gone, ['iron'])
})

await t('REVALIDATION BY IDENTITY: the iron at the take is now a SPENT iron of the same name -- not taken; the next best is', async () => {
  const w = withServer(town([], [p('stone_pickaxe', 0)]))
  w.set(-5, 64, 0, 'chest'); w.stock(-5, 64, 0, [p('iron_pickaxe', 200)])
  const open = w.bot.openContainer
  let n = 0
  w.bot.openContainer = async b => { if (++n === 3) w.containers.get('-5,64,0').slots[0] = p('iron_pickaxe', 245); return open(b) }   // 5 uses left: spent
  const r = await pick(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'iron_pickaxe'), 0, 'the spent iron was not taken'); assert.equal(count(w.bag, 'stone_pickaxe'), 1)
})

await t('THE BEST COPY\'S CHEST CANNOT BE REACHED at the take: the order STOPS -- never a worse copy instead', async () => {
  const w = withServer(town([], [p('wooden_pickaxe', 0)]))
  w.set(-5, 64, 0, 'chest'); w.stock(-5, 64, 0, [p('iron_pickaxe', 200)])
  const goto = w.bot.pathfinder.goto
  let toB = 0
  w.bot.pathfinder.goto = async goal => { if (goal.x === -5 && ++toB === 2) throw new Error('No path to the goal!'); return goto(goal) }
  const r = await pick(w.bot)
  assert.notEqual(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'wooden_pickaxe'), 0, 'no worse copy instead'); assert.equal(count(w.bag, 'iron_pickaxe'), 0)
  assert.equal(lastRow().args.best_valid, 'iron', 'the iron was not proven gone')
})

await t('UPGRADE WITH ROOM: a bot holding a wooden pickaxe takes the iron; the wooden one stays', async () => {
  const w = withServer(town([p('wooden_pickaxe', 10)], [p('iron_pickaxe', 0)]))
  const r = await pick(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'iron_pickaxe'), 1); assert.equal(count(w.bag, 'wooden_pickaxe'), 1)
  assert.equal(lastRow().args.held, 'wooden')
})

await t('UPGRADE, FULL BAG AND FULL CHEST: the WORSE pickaxe itself is traded for the better one (mode-2, by identity); totals conserved', async () => {
  const bag = [...Array.from({ length: 35 }, () => stack('cobblestone', 64)), p('wooden_pickaxe', 10)]
  const chest = [...Array.from({ length: 26 }, () => stack('cobblestone', 64)), p('iron_pickaxe', 0)]
  const w = withServer(town(bag, chest))
  const before = everything(w)
  const r = await pick(w.bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(count(w.bag, 'iron_pickaxe'), 1); assert.equal(count(w.bag, 'wooden_pickaxe'), 0)
  assert.equal(w.containers.get('5,64,0').slots[26]?.name, 'wooden_pickaxe', 'the wooden went into the iron\'s slot')
  assert.equal(count(w.bag, 'cobblestone'), 35 * 64, 'no material stack moved')
  assert.ok(w.spy.clicks.every(c => c[2] === 2), 'only number-key swaps'); assert.equal(everything(w), before); assert.equal(w.dropped.length, 0)
})

await t('NO BETTER: a bot holding stone beside wooden and stone copies takes nothing', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [p('wooden_pickaxe', 0), p('stone_pickaxe', 0)]))
  const r = await pick(w.bot)
  assert.equal(r.status, 'no_effect', r.detail)
  assert.equal(count(w.bag, 'stone_pickaxe'), 1); assert.equal(count(w.bag, 'wooden_pickaxe'), 0)
  assert.match(lastRow().detail, /^outcome=no_better /)
})

await t('IRON PATH: stone held, 5 ingots and sticks in the chest, a table in reach -> exactly 3 ingots + 2 sticks taken, an iron pickaxe crafted, verified', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [stack('iron_ingot', 5), stack('stick', 10)]))
  w.set(6, 64, 2, 'crafting_table')
  const calls = craftStub(w, 'honest')
  try {
    const r = await pick(w.bot)
    assert.equal(r.status, 'success', r.detail)
    assert.deepEqual(calls, [{ item: 'iron_pickaxe', count: 1 }])
    assert.equal(count(w.bag, 'iron_pickaxe'), 1); assert.equal(count(w.bag, 'iron_ingot'), 0)
    const chest = w.containers.get('5,64,0').slots.filter(Boolean)
    assert.equal(chest.find(s => s.name === 'iron_ingot').count, 2, 'exactly 3 taken'); assert.equal(chest.find(s => s.name === 'stick').count, 8, 'exactly 2 taken')
    const a = lastRow().args
    assert.equal(lastRow().detail.split(' ')[0], 'outcome=crafted_iron')
    assert.equal(a.craft, 'server'); assert.equal(a.produced, 1); assert.equal(a.srv.iron_pickaxe, 1); assert.equal(a.complete, true)
    assert.deepEqual([...a.transform].sort(), ['iron_ingot', 'stick'], 'what the craft consumed, measured')
    assert.equal(withdrawHolds().iron_pickaxe, 1, 'the new pickaxe is held from deposit')
    assert.equal(withdrawHolds().iron_ingot ?? 0, 0, 'the scoped holds were released')
  } finally { SKILLS.craft.run = realCraft }
})

await t('IRON PATH ACROSS TWO CHESTS: the sticks\' chest first, the ingots LAST', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [stack('stick', 10)]))
  w.set(-5, 64, 0, 'chest'); w.stock(-5, 64, 0, [stack('iron_ingot', 4)])
  w.set(6, 64, 2, 'crafting_table')
  const calls = craftStub(w, 'honest')
  const order = []
  const click = w.bot.clickWindow.bind(w.bot)
  w.bot.clickWindow = async (slot, button, mode) => { const it = w.bot.currentWindow?.get?.(slot); if (it) order.push(it.name); return click(slot, button, mode) }
  try {
    const r = await pick(w.bot)
    assert.equal(r.status, 'success', r.detail); assert.equal(calls.length, 1)
    assert.deepEqual(w.spy.opened, ['5,64,0', '-5,64,0', '5,64,0', '-5,64,0'], 'inspect both, sticks first, ingots last')
    assert.ok(order.indexOf('stick') < order.indexOf('iron_ingot'), `taken in order ${order.join(',')}`)
  } finally { SKILLS.craft.run = realCraft }
})

await t('A TOWN WITH NO PICKAXES (every chest a recent pickaxe miss): the iron path still looks in -- and crafts', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [stack('iron_ingot', 5), stack('stick', 10)]))
  w.set(6, 64, 2, 'crafting_table')
  updateMem(e => { e._pick_miss = { '5,64,0': Date.now() - 60_000 } })
  const calls = craftStub(w, 'honest')
  try {
    const r = await pick(w.bot)
    assert.equal(r.status, 'success', r.detail); assert.equal(calls.length, 1)
    assert.equal(lastRow().detail.split(' ')[0], 'outcome=crafted_iron')
  } finally { SKILLS.craft.run = realCraft }
})

await t('RE-PLAN BEFORE THE INGOTS: the bag picked up an ingot after the sticks\' visit -- only the remaining 2 are taken', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [stack('stick', 10)]))
  w.set(-5, 64, 0, 'chest'); w.stock(-5, 64, 0, [stack('iron_ingot', 4)])
  w.set(6, 64, 2, 'crafting_table')
  craftStub(w, 'honest')
  const open = w.bot.openContainer
  let n = 0
  w.bot.openContainer = async b => { if (++n === 3) { const i = w.bag.findIndex(x => !x); w.bag[i >= 0 ? i : w.bag.length] = stack('iron_ingot', 1) } return open(b) }   // an auto-pickup during the sticks' visit
  try {
    const r = await pick(w.bot)
    assert.equal(r.status, 'success', r.detail)
    assert.equal(w.containers.get('-5,64,0').slots.filter(Boolean).find(x => x.name === 'iron_ingot').count, 2, 'exactly the remaining deficit taken')
  } finally { SKILLS.craft.run = realCraft }
})

await t('A CRAFT THAT SAYS SUCCESS BUT MADE NOTHING is not an iron pickaxe (the server recount decides)', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [stack('iron_ingot', 5), stack('stick', 10)]))
  w.set(6, 64, 2, 'crafting_table')
  craftStub(w, 'liar')
  try {
    const r = await pick(w.bot)
    assert.notEqual(r.status, 'success', r.detail)
    assert.equal(lastRow().detail.split(' ')[0], 'outcome=craft_failed')
    assert.equal(lastRow().args.produced, 0)
  } finally { SKILLS.craft.run = realCraft }
})

await t('A FAILED CRAFT: the ingots stay in the bag, deposit keeps them, the holds are released, and the next order does not retry within 30 min', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [stack('iron_ingot', 5), stack('stick', 10)]))
  w.set(6, 64, 2, 'crafting_table')
  craftStub(w, 'fails')
  try {
    const r = await pick(w.bot)
    assert.equal(r.status, 'failed', r.detail)
    assert.equal(count(w.bag, 'iron_ingot'), 3, 'still in the bag')
    assert.equal(withdrawHolds().iron_ingot ?? 0, 0, 'hold released')
    assert.equal(bankableExclusion(w.bot.inventory.items(), 'iron_ingot'), 'iron_upgrade_reserve', 'deposit keeps them for the next try')
    const rows = RECS.filter(x => x.skill?.name === '_withdraw_pick').length
    const r2 = await pick(w.bot)
    assert.equal(RECS.filter(x => x.skill?.name === '_withdraw_pick').length, rows + 1, 'positive control: the second order ran')
    assert.equal(lastRow().args.iron, 'cooldown', r2.detail)
    assert.equal(count(w.bag, 'iron_ingot'), 3, 'nothing more taken')
  } finally { SKILLS.craft.run = realCraft }
})

await t('NOT ENOUGH INGOTS IN ONE CHEST: the iron path is declined -- nothing taken', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [stack('iron_ingot', 2), stack('stick', 10)]))
  w.set(6, 64, 2, 'crafting_table')
  const calls = craftStub(w, 'honest')
  try {
    const r = await pick(w.bot)
    assert.equal(r.status, 'no_effect', r.detail)
    assert.equal(calls.length, 0); assert.equal(count(w.bag, 'iron_ingot'), 0); assert.equal(count(w.bag, 'stick'), 0)
    assert.match(lastRow().args.iron, /^declined:/)
  } finally { SKILLS.craft.run = realCraft }
})

// ---------------------------------------------------------------- Codex code review, round 1 ---
await t('C1 P1: the sticks vanish before the take -- NOTHING is taken at that chest (no ingots without their sticks)', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [stack('iron_ingot', 3), stack('stick', 2)]))
  w.set(6, 64, 2, 'crafting_table')
  const calls = craftStub(w, 'honest')
  const open = w.bot.openContainer
  let n = 0
  w.bot.openContainer = async b => { if (++n === 2) w.containers.get('5,64,0').slots[1] = null; return open(b) }
  try {
    const r = await pick(w.bot)
    assert.notEqual(r.status, 'success', r.detail)
    assert.equal(count(w.bag, 'iron_ingot'), 0, 'no ingots taken'); assert.equal(calls.length, 0, 'no craft')
    assert.equal(lastRow().detail.split(' ')[0], 'outcome=iron_take_failed')
  } finally { SKILLS.craft.run = realCraft }
})

await t('C1 P2: held planks make the sticks -- stick/plank misses in town do not rule the iron path out', async () => {
  const w = withServer(town([p('stone_pickaxe', 0), stack('oak_planks', 2)], [stack('iron_ingot', 3)]))
  w.set(6, 64, 2, 'crafting_table')
  updateMem(e => { e._ingredient_miss = { '5,64,0': { stick: Date.now() - 1000, planks: Date.now() - 1000 } }; e._ingot_seen = { '5,64,0': { at: Date.now() - 1000, count: 3 } } })
  assert.equal(townIronRuledOut(w.bot), false)
})

await t('C1 P2: a chest known to hold no pickaxe and no ingots, but sticks, is still looked in -- and supplies them', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [stack('stick', 2)]))
  w.set(-5, 64, 0, 'chest'); w.stock(-5, 64, 0, [stack('iron_ingot', 3)])
  w.set(6, 64, 2, 'crafting_table')
  updateMem(e => { e._pick_miss = { '5,64,0': Date.now() - 1000 }; e._ingot_seen = { '5,64,0': { at: Date.now() - 1000, count: 0 } } })
  const calls = craftStub(w, 'honest')
  try {
    const r = await pick(w.bot)
    assert.equal(r.status, 'success', r.detail); assert.equal(calls.length, 1)
    assert.ok(w.spy.opened.includes('5,64,0'))
  } finally { SKILLS.craft.run = realCraft }
})

await t('C1 P2: the room for BOTH visits must fit the first chest -- else declined before anything moves', async () => {
  // deposit credits at most 64 of a name, so the room-making stacks are of different bankable names
  const bag = [p('stone_pickaxe', 0), ...Array.from({ length: 32 }, () => stack('dirt', 64)), stack('coal', 64), stack('diamond', 64), stack('raw_iron', 64)]
  const w = withServer(town(bag, [...Array.from({ length: 25 }, () => stack('dirt', 64)), stack('stick', 10)]))   // 1 empty slot
  w.set(-5, 64, 0, 'chest'); w.stock(-5, 64, 0, [...Array.from({ length: 26 }, () => stack('dirt', 64)), stack('iron_ingot', 3)])   // full
  w.set(6, 64, 2, 'crafting_table')
  const calls = craftStub(w, 'honest')
  try {
    const r = await pick(w.bot)
    assert.notEqual(r.status, 'success', r.detail)
    assert.match(lastRow().args.iron, /^declined:no room in the chest/)
    assert.equal(count(w.bag, 'stick'), 0); assert.equal(count(w.bag, 'coal') + count(w.bag, 'diamond') + count(w.bag, 'raw_iron'), 3 * 64, 'nothing moved'); assert.equal(calls.length, 0)
  } finally { SKILLS.craft.run = realCraft }
})

await t('C1 P2 positive: with room in the first chest, room for BOTH visits is made there -- then sticks, then ingots, then the craft', async () => {
  const bag = [p('stone_pickaxe', 0), ...Array.from({ length: 32 }, () => stack('dirt', 64)), stack('coal', 64), stack('diamond', 64), stack('raw_iron', 64)]
  const w = withServer(town(bag, [stack('stick', 10)]))                                                           // plenty of room
  w.set(-5, 64, 0, 'chest'); w.stock(-5, 64, 0, [...Array.from({ length: 26 }, () => stack('dirt', 64)), stack('iron_ingot', 3)])   // full
  w.set(6, 64, 2, 'crafting_table')
  const calls = craftStub(w, 'honest')
  try {
    const r = await pick(w.bot)
    assert.equal(r.status, 'success', r.detail); assert.equal(calls.length, 1)
    assert.equal(Object.values(lastRow().args.gave).reduce((a, b) => a + b, 0), 128, 'two stacks banked at the first chest')
  } finally { SKILLS.craft.run = realCraft }
})

await t('C1 P2: ONE take-visit budget per order: a diamond proven gone spends a visit, so a two-visit iron plan is declined', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [p('diamond_pickaxe', 0)]))
  w.set(-5, 64, 0, 'chest'); w.stock(-5, 64, 0, [stack('stick', 10)])
  w.set(0, 64, 5, 'chest'); w.stock(0, 64, 5, [stack('iron_ingot', 3)])
  w.set(6, 64, 2, 'crafting_table')
  const calls = craftStub(w, 'honest')
  const open = w.bot.openContainer
  let n = 0
  w.bot.openContainer = async b => { if (++n === 4) w.containers.get('5,64,0').slots[0] = null; return open(b) }   // the diamond is gone at its revisit
  try {
    await pick(w.bot)
    assert.equal(lastRow().args.iron, 'declined:visit budget'); assert.equal(calls.length, 0)
    assert.equal(w.spy.opened.length, 4, 'three looks and one take visit')
  } finally { SKILLS.craft.run = realCraft }
})

await t('C1 P2: an ABORT after the pickaxe was made (during the table retake): the new pickaxe is still held from deposit', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [stack('iron_ingot', 5), stack('stick', 10)]))
  w.set(6, 64, 2, 'crafting_table')
  craftStub(w, 'abortAfter')
  try {
    await assert.rejects(pick(w.bot), /aborted/)
    assert.equal(count(w.bag, 'iron_pickaxe'), 1)
    assert.equal(withdrawHolds().iron_pickaxe, 1, 'held although the craft threw')
    const row = lastRow()
    assert.equal(row.detail.split(' ')[0], 'outcome=aborted')
    assert.equal(row.args.produced, 1, 'the thrown row keeps the ledger (Codex round 2)'); assert.equal(row.args.srv.iron_pickaxe, 1); assert.equal(row.args.complete, true)
    assert.equal(row.args.took.iron_ingot, 3)
  } finally { SKILLS.craft.run = realCraft }
})

// ---------------------------------------------------------------- Codex code review, round 2 ---
await t('C2 P1: the sticks vanish AFTER the room-making click in the same transfer -- the ingots are not taken', async () => {
  const bag = [p('stone_pickaxe', 0), ...Array.from({ length: 32 }, () => stack('dirt', 64)), stack('coal', 64), stack('diamond', 64), stack('raw_iron', 64)]
  const w = withServer(town(bag, [stack('iron_ingot', 3), stack('stick', 2)]))
  w.set(6, 64, 2, 'crafting_table')
  const calls = craftStub(w, 'honest')
  const click = w.bot.clickWindow.bind(w.bot)
  let n = 0
  w.bot.clickWindow = async (slot, button, mode) => { const r = await click(slot, button, mode); if (++n === 1) w.containers.get('5,64,0').slots[1] = null; return r }
  try {
    const r = await pick(w.bot)
    assert.notEqual(r.status, 'success', r.detail)
    assert.equal(count(w.bag, 'iron_ingot'), 0, 'no ingots without their sticks'); assert.equal(calls.length, 0)
  } finally { SKILLS.craft.run = realCraft }
})

await t('C2 P2: an unrelated loss during the craft is NOT exempted as recipe consumption (G1 still sees it)', async () => {
  const w = withServer(town([p('stone_pickaxe', 0), stack('diamond', 8)], [stack('iron_ingot', 5), stack('stick', 10)]))
  w.set(6, 64, 2, 'crafting_table')
  craftStub(w, 'honestLosesDiamonds')
  try {
    await pick(w.bot)
    const a = lastRow().args
    assert.equal(a.srv.diamond, -8, 'positive control: the loss is in the ledger')
    assert.ok(!a.transform.includes('diamond'), `transform ${a.transform}`)
    assert.ok(!a.plan.includes('diamond'))
  } finally { SKILLS.craft.run = realCraft }
})

await t('C3 P2: an order ABORTED mid-transfer keeps what that transfer moved in its ledger (complete stays false)', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [stack('stick', 2), stack('iron_ingot', 3)]))
  w.set(6, 64, 2, 'crafting_table')
  const calls = craftStub(w, 'honest')
  const ac = new AbortController(); const click = w.bot.clickWindow.bind(w.bot)
  w.bot.clickWindow = async (...a) => { const r = await click(...a); ac.abort(); return r }   // abort right after the sticks' click
  try {
    await assert.rejects(SKILLS.withdraw_pick.run({ bot: w.bot }, {}, ac.signal))
    assert.equal(count(w.bag, 'stick'), 2, 'positive control: the sticks did move'); assert.equal(calls.length, 0)
    const a = lastRow().args
    assert.equal(a.outcome, 'aborted')
    assert.equal(a.took.stick, 2, `ledger took ${JSON.stringify(a.took)}`)
    assert.equal(a.complete, false, 'no final server recount on the way out of an abort')
  } finally { SKILLS.craft.run = realCraft }
})

await t('C4 P2: an abort in the middle of a PART-STACK take keeps what reached the bag (placed + rescued) in the ledger', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [stack('stick', 10), stack('iron_ingot', 3)]))
  w.set(6, 64, 2, 'crafting_table')
  const calls = craftStub(w, 'honest')
  const ac = new AbortController(); const click = w.bot.clickWindow.bind(w.bot)
  let n = 0
  w.bot.clickWindow = async (...a) => { const r = await click(...a); if (++n === 3) ac.abort(); return r }   // pickup, 1 placed, 1 placed -> abort
  try {
    await assert.rejects(SKILLS.withdraw_pick.run({ bot: w.bot }, {}, ac.signal))
    const inBag = count(w.bag, 'stick')
    assert.ok(inBag > 0, `positive control: sticks reached the bag (${inBag})`); assert.equal(calls.length, 0)
    const a = lastRow().args
    assert.equal(a.took.stick, inBag, `ledger took ${JSON.stringify(a.took)} vs ${inBag} in the bag`)
    assert.equal(a.complete, false)
  } finally { SKILLS.craft.run = realCraft }
})

await t('C5 P2: AUTO-PICKUPS are not withdrawals -- a failed part-stack take counts only what left the chest (placed + rescued)', async () => {
  // (a) 8 ingots auto-picked up into the planned stick slot after the sticks were lifted: the take stops; the 5 lifted
  //     sticks are rescued into the bag (they did leave the chest); NO ingot was taken and the chest's 3 stay evidence.
  {
    const w = withServer(town([p('stone_pickaxe', 0)], [stack('stick', 10), stack('iron_ingot', 3)]))
    w.set(6, 64, 2, 'crafting_table')
    const click = w.bot.clickWindow.bind(w.bot); let n = 0
    w.bot.clickWindow = async (...a) => { const r = await click(...a); if (++n === 1) w.bag[1] = stack('iron_ingot', 8); return r }
    await pick(w.bot)
    const a = lastRow().args
    const chestSticks = count(w.containers.get('5,64,0').slots, 'stick')
    assert.equal(count(w.containers.get('5,64,0').slots, 'iron_ingot'), 3, 'positive control: the chest kept its ingots')
    assert.equal(a.took.iron_ingot ?? 0, 0, `took ${JSON.stringify(a.took)}`)
    assert.equal(a.took.stick ?? 0, 10 - chestSticks, 'exactly what left the chest')
    assert.equal(W.townIngotsRuledOut(await readMem(), ['5,64,0'], 3), false, 'the 3 ingots are still evidence for the next bot')
  }
  // (b) the bag fills (dirt + 64 auto-picked sticks) after the lift: the cursor goes back to the chest; nothing taken.
  {
    const w = withServer(town([p('stone_pickaxe', 0)], [stack('stick', 10), stack('iron_ingot', 3)]))
    w.set(6, 64, 2, 'crafting_table')
    const click = w.bot.clickWindow.bind(w.bot); let n = 0
    w.bot.clickWindow = async (...a) => { const r = await click(...a); if (++n === 1) { for (let i = 2; i < 36; i++) w.bag[i] = stack('dirt', 64); w.bag[1] = stack('stick', 64) } return r }
    await pick(w.bot)
    assert.equal(count(w.containers.get('5,64,0').slots, 'stick'), 10, 'positive control: every lifted stick went back')
    assert.deepEqual(lastRow().args.took, {}, 'the 64 auto-picked sticks are not a withdrawal')
  }
})

await t('EVIDENCE AFTER A LOOK: nothing better and no ingots in the only chest -> the gate\'s two "ruled out"s are true', async () => {
  const w = withServer(town([p('stone_pickaxe', 0)], [p('wooden_pickaxe', 0), stack('dirt', 5)]))
  assert.equal(townBetterPickMiss(w.bot), false, 'positive control: not yet known')
  assert.equal(townIronRuledOut(w.bot), false)
  await pick(w.bot)
  const m = await readMem()
  assert.equal(m._pick_best['5,64,0'].tier, W.heldPickTier([p('wooden_pickaxe', 0)]))
  assert.equal(m._ingot_seen['5,64,0'].count, 0)
  assert.equal(townBetterPickMiss(w.bot), true); assert.equal(townIronRuledOut(w.bot), true)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
