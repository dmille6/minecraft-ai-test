// THE PEACEFUL KIT (peacefulkit.mjs, owner 10-07): swords banked, never crafted, never chased; the plants a peaceful world
// cannot use composted -- under the food policy's ONE switch. Behaviour, not text: the decisions are pure exports, and the
// wiring is driven through the REAL deposit skill (fakeworld.mjs), the REAL admission gate, the REAL craft skill, the REAL
// pickup sweep and the REAL difficulty listener. The compost skill's wiring is in composter.test.mjs (its fake composter),
// the town order's in peacefulkit-order.test.mjs (the real cognitive loop).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-peacefulkit-logs-'))
process.env.BOT_NAME = 'KitBot'
process.env.HOME_X = '0'; process.env.HOME_Y = '64'; process.env.HOME_Z = '0'
process.env.SKILL_TIMEOUT_MS = '180000'
process.env.POOL_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-peacefulkit-pool-'))
const assert = (await import('node:assert/strict')).default
const test = (await import('node:test')).default
const { execFileSync } = await import('node:child_process')
const { createRequire } = await import('node:module')
const { EventEmitter } = await import('node:events')
const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')

const K = await import('../src/peacefulkit.mjs')
const C = await import('../src/composter.mjs')
const { NEVER_KEEP } = await import('../src/hygiene.mjs')
const { bankableInventory, depositPlan } = await import('../src/bankable.mjs')
const { attachDifficulty, peacefulFoodActive, setPeacefulFood } = await import('../src/foodskip.mjs')
const { SKILLS, pickupNearbyItems, foodSkipNow, classifyOutcome } = await import('../src/skills.mjs')
const { AdmissionControl } = await import('../src/admission.mjs')
const { tapRecords } = await import('../src/logger.mjs')
const { fakeWorld, stack, tool } = await import('./fakeworld.mjs')

// ---- the lists ------------------------------------------------------------------------------------------------------
// THE PAPER TABLE (sandbox2, Paper 1.21.8-60, 10-07, RCON only: 64 of each through a hopper into a real composter):
// every kit plant was consumed 64/64; the negative controls 0. docs/reports/peacefulkit-design-2026-10-07.md.
const PAPER_CONSUMED = ['melon_slice', 'kelp', 'brown_mushroom', 'red_mushroom', 'torchflower_seeds', 'pitcher_pod', 'cocoa_beans',
  'sweet_berries', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy',
  'cornflower', 'lily_of_the_valley', 'wither_rose', 'torchflower', 'pitcher_plant', 'closed_eyeblossom', 'open_eyeblossom',
  'sunflower', 'lilac', 'rose_bush', 'peony', 'wildflowers', 'pink_petals', 'cactus_flower']
const PAPER_REFUSED = ['stone_sword', 'wooden_sword', 'egg', 'flint', 'bamboo', 'dead_bush', 'ink_sac']

test('the kit\'s plants are exactly the Paper-verified list; real 1.21.8 items; vanilla chances; nothing already composted', () => {
  assert.deepEqual(Object.keys(K.PEACEFUL_COMPOST).sort(), [...PAPER_CONSUMED].sort())
  for (const [n, p] of Object.entries(K.PEACEFUL_COMPOST)) {
    assert.ok(mcData.itemsByName[n], `${n} is a 1.21.8 item`)
    assert.ok([0.3, 0.5, 0.65, 0.85].includes(p), `${n} chance ${p}`)
    assert.equal(Object.hasOwn(C.COMPOST_CHANCE, n), false, `${n} is already composted without the switch`)
    assert.equal(NEVER_KEEP.has(n), false, `${n} is NEVER_KEEP ballast already`)
    assert.equal(K.isSword(n), false)
  }
  for (const n of PAPER_REFUSED) assert.equal(K.isPeacefulCompost(n), false, `${n} is not compostable on Paper`)
  for (const n of ['apple', 'bread', 'dried_kelp', 'glow_berries', 'carrot', 'oak_sapling', 'bush', 'firefly_bush', 'moss_carpet', 'bone_meal'])
    assert.equal(K.isPeacefulCompost(n), false, `${n} was not approved`)
  assert.equal(K.PEACEFUL_COMPOST.melon_slice, 0.5); assert.equal(K.PEACEFUL_COMPOST.torchflower, 0.85); assert.equal(K.PEACEFUL_COMPOST.wildflowers, 0.3)
})

test('swords: every tier; the refusal only while active and only for a sword; it names a verb the bot can use anywhere', () => {
  for (const n of ['wooden_sword', 'stone_sword', 'iron_sword', 'golden_sword', 'diamond_sword', 'netherite_sword']) {
    assert.ok(mcData.itemsByName[n]); assert.equal(K.isSword(n), true, n)
    assert.match(K.swordCraftRefusal(n, true), /not crafted in a peaceful world.*craft a pickaxe, axe or shovel, or gather instead/)
    assert.equal(K.swordCraftRefusal(n, false), null, `${n} off`)
  }
  for (const n of ['stone_pickaxe', 'wooden_axe', 'stick', 'oak_planks', undefined, null]) assert.equal(K.swordCraftRefusal(n, true), null, String(n))
  const drop = name => ({ getDroppedItem: () => ({ name }) })
  assert.equal(K.skipSwordDrop(drop('stone_sword'), true), true)
  assert.equal(K.skipSwordDrop(drop('stone_sword'), false), false)
  assert.equal(K.skipSwordDrop(drop('cobblestone'), true), false)
  assert.equal(K.skipSwordDrop({ getDroppedItem: () => { throw new Error('no metadata') } }, true), false, 'unreadable: chased as before')
  assert.equal(K.bankEveryCopy('stone_sword', true), true)
  assert.equal(K.bankEveryCopy('stone_sword', false), false)
  assert.equal(K.bankEveryCopy('stone_pickaxe', true), false, 'only swords')
})

// ---- the composer: pure ------------------------------------------------------------------------------------------------
const S = (name, count, slot) => ({ name, count, slot })
const KITBAG = () => [S('wildflowers', 40, 9), S('melon_slice', 9, 10), S('kelp', 12, 11), S('brown_mushroom', 2, 12), S('red_tulip', 1, 13),
  S('cocoa_beans', 3, 14), S('torchflower_seeds', 2, 15), S('apple', 10, 16), S('oak_sapling', 20, 17), S('birch_sapling', 8, 18),
  S('leaf_litter', 5, 19), S('bread', 5, 20), S('dried_kelp', 4, 21), S('stone_sword', 1, 22), S('wooden_sword', 1, 23)]

test('OFF IS TODAY: without `plants` the allowance, plan and next insert are exactly the old ones (the kit plants stay)', () => {
  const bag = KITBAG()
  assert.deepEqual(C.compostAllowance(bag), C.compostAllowance(bag, { apples: false, plants: false }))
  assert.deepEqual(C.compostAllowance(bag), { oak_sapling: 4, leaf_litter: 5 })
  assert.deepEqual(C.compostAllowance(bag, { apples: true }), { oak_sapling: 4, leaf_litter: 5, apple: 6 }, 'the food policy alone: apples, no plants')
  assert.deepEqual(C.compostPlan(bag), C.compostPlan(bag, { plants: false }))
})

test('ON: every kit plant WHOLE, saplings only above 16, apples only above 4; food, swords and the unapproved never', () => {
  const allow = C.compostAllowance(KITBAG(), { apples: true, plants: true })
  assert.deepEqual(allow, { wildflowers: 40, melon_slice: 9, kelp: 12, brown_mushroom: 2, red_tulip: 1, cocoa_beans: 3, torchflower_seeds: 2,
    apple: 6, oak_sapling: 4, leaf_litter: 5 })
  assert.equal(C.compostAllowance([S('wildflowers', 64)], { plants: false }).wildflowers, undefined)
})

test('ON, insert by insert to the end (room every time): the bag ends with no kit plant, 16 oak saplings, 4 apples, both swords', () => {
  let bag = KITBAG()
  for (let i = 0; i < 500; i++) {
    const nx = C.nextInsert(bag, { room: true, apples: true, plants: true })
    if (!nx) break
    assert.ok(nx.n > 0 && nx.n <= nx.item.count)
    bag = bag.map(s => s === nx.item ? { ...s, count: s.count - 1 } : s).filter(s => s.count > 0)   // one item per use
  }
  const left = Object.fromEntries(bag.map(s => [s.name, s.count]))
  for (const n of Object.keys(K.PEACEFUL_COMPOST)) assert.equal(left[n], undefined, `${n} left over`)
  assert.equal(left.oak_sapling, 16); assert.equal(left.birch_sapling, 8); assert.equal(left.apple, 4)
  assert.equal(left.stone_sword, 1); assert.equal(left.wooden_sword, 1); assert.equal(left.bread, 5); assert.equal(left.dried_kelp, 4)
})

test('a FULL bag only starts a fill that empties a slot: the smallest whole kit stack goes first', () => {
  const full = [S('wildflowers', 40, 9), S('red_tulip', 1, 10), ...Array.from({ length: 34 }, (_, i) => S('cobblestone', 64, 11 + i))]
  assert.equal(C.boneMealRoom(full), false)
  const nx = C.nextInsert(full, { room: false, plants: true })
  assert.equal(nx.item.name, 'red_tulip'); assert.equal(nx.n, 1)
  assert.equal(C.nextInsert(full, { room: false }), null, 'off: nothing in this bag is compostable')
})

test('ORDER of insertion (room): the kit\'s seeds with the seeds, its flowers with the flowers, its food last', () => {
  let bag = [S('melon_slice', 2, 9), S('wildflowers', 2, 10), S('torchflower_seeds', 1, 11), S('red_tulip', 1, 12), S('leaf_litter', 1, 13)]
  const seen = []
  for (let i = 0; i < 20; i++) {
    const nx = C.nextInsert(bag, { room: true, plants: true })
    if (!nx) break
    if (seen.at(-1) !== nx.item.name) seen.push(nx.item.name)
    bag = bag.map(s => s === nx.item ? { ...s, count: s.count - 1 } : s).filter(s => s.count > 0)
  }
  assert.deepEqual(seen, ['leaf_litter', 'torchflower_seeds', 'red_tulip', 'wildflowers', 'melon_slice'])
})

test('startableJunk: a full bag whose every kit stack is above 7 starts no order (a free no_effect each cooldown); one small stack does', () => {
  const fill = n => Array.from({ length: n }, (_, i) => S('cobblestone', 64, 20 + i))
  const big = [S('wildflowers', 30, 9), S('melon_slice', 9, 10), ...fill(34)]
  assert.equal(C.compostPlan(big, { plants: true }).junk, 39, 'the plan sees the plants')
  assert.equal(C.startableJunk(big, { plants: true }), 0, 'but no fill can start')
  const small = [S('wildflowers', 30, 9), S('red_tulip', 3, 10), ...fill(34)]
  assert.equal(C.startableJunk(small, { plants: true }), 33)
  assert.equal(C.startableJunk(big.slice(0, 35), { plants: true }), 39, 'a free slot: room for the bone meal')
  assert.equal(C.startableJunk(big, {}), 0, 'off: nothing compostable')
  // THE COMPOSTER'S LEVEL (Codex r2): a stack of 3 empties before 7 only from level <= 4; at 7 and 8 a full bag cannot start
  for (const [level, want] of [[0, 33], [4, 33], [5, 0], [6, 0], [7, 0], [8, 0], [null, 33]]) {
    assert.equal(C.startableJunk(small, { plants: true, level }), want, `level ${level}`)
    assert.equal(C.startableJunk(small, { plants: true, level: () => level }), want, `lazy level ${level}`)
  }
  // junk that no whole stack can carry out (saplings above the reserve inside one stack of 30): no fill can start
  const saplings = [S('oak_sapling', 30, 9), ...fill(35)]
  assert.equal(C.compostPlan(saplings).junk, 14)
  assert.equal(C.startableJunk(saplings, { plants: true }), 0)
  let asked = 0
  C.startableJunk(big.slice(0, 35), { plants: true, level: () => { asked++; return 8 } })
  assert.equal(asked, 0, 'a bag with room never asks the world for the level')
})

// ---- the bank: pure ----------------------------------------------------------------------------------------------------
const T = (name, used = 0, slot = 9) => ({ name, count: 1, slot, maxDurability: { wooden: 59, stone: 131, iron: 250 }[name.split('_')[0]] ?? 131, durabilityUsed: used })

test('BANK pure: on, every usable sword is bankable (none kept); off, the one-per-name rule; a spent sword never; pickaxes unchanged', () => {
  const bag = [T('stone_sword', 0, 9), T('wooden_sword', 0, 10), T('stone_pickaxe', 30, 11), T('stone_pickaxe', 5, 12), stack('cobblestone', 64)]
  const on = depositPlan(bag, null, { swords: true }), off = depositPlan(bag, null, { swords: false })
  const n = (plan, name) => plan.find(e => e.name === name)?.count ?? 0
  assert.equal(n(on, 'stone_sword'), 1); assert.equal(n(on, 'wooden_sword'), 1)
  assert.equal(n(off, 'stone_sword'), 0); assert.equal(n(off, 'wooden_sword'), 0)
  assert.equal(n(on, 'stone_pickaxe'), n(off, 'stone_pickaxe'), 'pickaxes: the same rule either way')
  assert.equal(bankableInventory(bag, { swords: false }).excluded.stone_sword, 'last_of_tool_family')
  assert.equal(bankableInventory([T('stone_sword', 125)], { swords: true }).count, 0, 'a spent sword (<= FLOOR uses) never moves')
  assert.equal(bankableInventory([T('stone_sword'), T('stone_sword', 0, 10)], { swords: false }).detail.stone_sword, 1, 'off: a SPARE sword still goes, as today')
  assert.equal(bankableInventory([T('stone_sword'), T('stone_sword', 0, 10)], { swords: true }).detail.stone_sword, 2)
})

test('NO NEW TRIP: the default allowance is the BASE rule whatever the switch -- admission, the prompt and the milestone count as before', () => {
  for (const on of [false, true]) {
    setPeacefulFood(on)
    assert.equal(bankableInventory([T('stone_sword')]).count, 0, `switch ${on}: a sword alone makes nothing bankable`)
  }
  setPeacefulFood(false)
})

test('NO NEW TRIP, through the gate: 11 bankable items + a sword, beside the chest, under 30 slots: deposit refused while ON as while off', () => {
  const items = [stack('raw_copper', 11), tool('stone_sword'), tool('stone_pickaxe', 30)]
  for (const difficulty of ['peaceful', 'easy']) {
    const w = townWith(items.map(i => ({ ...i })), difficulty)
    foodSkipNow(w.bot)
    const r = new AdmissionControl().check({ skill: 'deposit', args: {} }, w.bot)
    assert.equal(r.reason, 'deposit_not_worth_it', `${difficulty}: ${JSON.stringify(r)}`)
  }
  setPeacefulFood(false)
})

// ---- the bank: the REAL deposit skill --------------------------------------------------------------------------------------
const runDeposit = (bot, args = {}) => SKILLS.deposit.run({ bot }, args, new AbortController().signal)
function townWith (bag, difficulty) {
  const w = fakeWorld({ bag })
  w.set(5, 64, 0, 'chest')
  w.bot.serverDifficulty = difficulty
  return w
}
const inChest = (w, name) => w.containers.get('5,64,0').slots.filter(s => s?.name === name).length
const inBag = (w, name) => w.bag.filter(s => s?.name === name).length

for (const [why, difficulty, banked] of [['PEACEFUL', 'peaceful', true], ['EASY world', 'easy', false], ['difficulty unknown', undefined, false]]) {
  test(`DEPOSIT WIRED, ${why}: an unnamed deposit ${banked ? 'banks BOTH swords (nothing kept)' : 'keeps both swords (the old rule)'}; the best pickaxe stays; nothing dropped`, async () => {
    const w = townWith([tool('stone_sword'), tool('wooden_sword'), tool('stone_pickaxe', 30), tool('stone_pickaxe', 100), stack('cobblestone', 64), stack('oak_log', 30)], difficulty)
    const r = await runDeposit(w.bot)
    assert.equal(r.status, 'success', r.detail)
    assert.equal(inChest(w, 'stone_sword') + inChest(w, 'wooden_sword'), banked ? 2 : 0)
    assert.equal(inBag(w, 'stone_sword') + inBag(w, 'wooden_sword'), banked ? 0 : 2)
    assert.equal(inBag(w, 'stone_pickaxe'), 1, 'one pickaxe kept')
    assert.equal(w.bag.find(s => s?.name === 'stone_pickaxe')?.durabilityUsed, 30, 'the BEST pickaxe is the one kept')
    assert.deepEqual(w.dropped, [], 'never dropped')
  })
}

test('DEPOSIT WIRED: a NAMED deposit of a sword under the kit banks every usable copy; a spent one stays', async () => {
  const w = townWith([tool('stone_sword'), tool('stone_sword', 125), tool('stone_sword', 3), stack('cobblestone', 64)], 'peaceful')
  const r = await runDeposit(w.bot, { item: 'stone_sword' })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(inChest(w, 'stone_sword'), 2)
  assert.equal(w.bag.filter(s => s?.name === 'stone_sword').map(s => s.durabilityUsed).join(), '125', 'the spent copy is not the bank\'s')
})

test('DEPOSIT WIRED: a FULL chest and nothing but the kit\'s swords to hand over -> no_effect; no new chest, no bank closure (Claude r2)', async () => {
  const { bankClosed } = await import('../src/chestfull.mjs')
  const w = townWith([tool('stone_sword'), tool('stone_pickaxe', 30), stack('dirt', 5)], 'peaceful')
  w.fill(5, 64, 0)
  const r = await runDeposit(w.bot)
  assert.equal(r.status, 'no_effect', r.detail)
  assert.match(r.detail, /swords; they wait for the next deposit/)
  assert.equal(w.spy.placed.length, 0, 'no chest built for one sword')
  assert.equal(w.spy.craft + w.spy.recipesFor, 0)
  assert.equal(bankClosed(w.bot), '', 'the bank is not closed for one sword')
  assert.equal(inBag(w, 'stone_sword'), 1); assert.deepEqual(w.dropped, [])
})

// ---- the craft: admission and the skill -----------------------------------------------------------------------------------
const V = (x, y, z) => ({ x, y, z, distanceTo (o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z) }, floored () { return this } })
const craftBot = difficulty => ({ registry: mcData, serverDifficulty: difficulty, entity: { position: V(0, 64, 0) }, inventory: { items: () => [] },
  calls: 0, recipesFor () { this.calls++; return [] }, findBlock () { return null } })

test('ADMISSION: craft <sword> is refused before any walk while active, with the kit\'s reason; admitted again off', () => {
  for (const item of ['wooden_sword', 'stone_sword', 'iron_sword']) {
    const r = new AdmissionControl().check({ skill: 'craft', args: { item, count: 1 } }, craftBot('peaceful'))
    assert.equal(r.ok, false); assert.equal(r.reason, 'peaceful_no_sword'); assert.match(r.detail, /not crafted in a peaceful world/)
  }
  for (const d of ['easy', 'hard', undefined]) {
    const r = new AdmissionControl().check({ skill: 'craft', args: { item: 'wooden_sword', count: 1 } }, craftBot(d))
    assert.notEqual(r.reason, 'peaceful_no_sword', `difficulty ${d}`)
  }
  const pick = new AdmissionControl().check({ skill: 'craft', args: { item: 'stone_pickaxe', count: 1 } }, craftBot('peaceful'))
  assert.notEqual(pick.reason, 'peaceful_no_sword', 'a pickaxe is not a sword')
})

test('THE REFUSAL CHAIN: a refused sword craft names a remedy the gate then ADMITS (craft a pickaxe), from the same bot', () => {
  const bot = craftBot('peaceful')
  const r = new AdmissionControl().check({ skill: 'craft', args: { item: 'stone_sword', count: 1 } }, bot)
  assert.equal(r.reason, 'peaceful_no_sword')
  const remedy = /craft a (pickaxe)/.exec(r.detail)
  assert.ok(remedy, r.detail)
  const next = new AdmissionControl().check({ skill: 'craft', args: { item: 'stone_pickaxe', count: 1 } }, bot)
  assert.equal(next.ok, true, JSON.stringify(next))
  const g = new AdmissionControl().check({ skill: 'gather', args: { block: 'oak_log', count: 1 } }, bot)
  assert.equal(g.ok, true, `gather, the other remedy: ${JSON.stringify(g)}`)
})

test('CRAFT SKILL: a sword is refused at the top (no recipe looked up) while active; off it is attempted as before', async () => {
  const on = craftBot('peaceful')
  const r = await SKILLS.craft.run({ bot: on }, { item: 'stone_sword' }, new AbortController().signal)
  assert.equal(r.status, 'no_effect'); assert.match(r.detail, /not crafted in a peaceful world/); assert.equal(on.calls, 0)
  const off = craftBot('normal')
  const r2 = await SKILLS.craft.run({ bot: off }, { item: 'stone_sword' }, new AbortController().signal).catch(e => ({ status: 'threw', detail: String(e) }))
  assert.ok(off.calls >= 1, `off: the craft looked for a recipe (${r2.status}: ${r2.detail})`)
})

// ---- the pickup sweep ----------------------------------------------------------------------------------------------------
function sweepBot (difficulty) {
  const visited = []
  const drop = (id, what, x) => ({ id, what, name: 'item', position: V(x, 0, 0), getDroppedItem: () => ({ name: what }) })
  const alive = new Map([drop(1, 'stone_sword', 1), drop(2, 'cobblestone', 2), drop(3, 'wooden_sword', 3)].map(d => [d.id, d]))
  const bot = { serverDifficulty: difficulty, registry: mcData, entity: { position: V(0, 0, 0) },
    nearestEntity (pred) { const c = [...alive.values()].filter(pred); c.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)); return c[0] ?? null },
    pathfinder: { async goto (g) { const d = [...alive.values()].find(q => q.position.x === g.x); visited.push(d.what); bot.entity.position = V(g.x, g.y, g.z); alive.delete(d.id) } } }
  return { bot, visited }
}
test('SWEEP: peaceful walks past both swords to the cobblestone; not peaceful chases them as before', async () => {
  const on = sweepBot('peaceful'); await pickupNearbyItems(on.bot, null)
  assert.deepEqual(on.visited, ['cobblestone'])
  for (const d of ['easy', undefined]) {
    const off = sweepBot(d); await pickupNearbyItems(off.bot, null)
    assert.deepEqual(off.visited, ['stone_sword', 'cobblestone', 'wooden_sword'], `difficulty ${d}`)
  }
})

// ---- the switch: the difficulty packet refreshes the decision every other module reads --------------------------------
test('ONE SWITCH: the difficulty packet sets the decision (auto); FOOD_SKIP=off never; =on from the start', () => {
  const botOf = () => { const b = {}; b._client = new EventEmitter(); return b }
  setPeacefulFood(false)
  const a = botOf(); attachDifficulty(a, {})
  assert.equal(peacefulFoodActive(), false, 'no packet yet: off')
  a._client.emit('difficulty', { difficulty: 'peaceful' }); assert.equal(peacefulFoodActive(), true)
  a._client.emit('difficulty', { difficulty: 'hard' }); assert.equal(peacefulFoodActive(), false, 'the world turned hard: all of it off')
  a._client.emit('difficulty', { difficulty: 0 }); assert.equal(peacefulFoodActive(), true, 'the older numeric form')
  const o = botOf(); attachDifficulty(o, { FOOD_SKIP: 'off' }); o._client.emit('difficulty', { difficulty: 'peaceful' })
  assert.equal(peacefulFoodActive(), false, 'off: never, whatever the world')
  const n = botOf(); attachDifficulty(n, { FOOD_SKIP: 'on' })
  assert.equal(peacefulFoodActive(), true, 'on: before any packet')
  setPeacefulFood(false)
})

test('THE ROW: one `_peaceful_kit` row per change of (decision, difficulty), beside `_food_skip`', () => {
  const rows = []
  const b = { serverDifficulty: 'normal', registry: mcData }
  foodSkipNow(b)   // a known starting state, whatever the tests before left (the row's memory is per process)
  const untap = tapRecords(r => { if (r?.skill?.name === '_peaceful_kit') rows.push(r.skill.detail) })
  try {
    b.serverDifficulty = 'hard'
    foodSkipNow(b); foodSkipNow(b)
    b.serverDifficulty = 'peaceful'; foodSkipNow(b); foodSkipNow(b)
    b.serverDifficulty = 'easy'; foodSkipNow(b)
  } finally { untap() }
  assert.deepEqual(rows, [
    'peaceful kit off: swords=as_before compost=as_before mode=auto difficulty=hard active=0',
    'peaceful kit ON: swords=bank,no_craft,no_chase compost=plants mode=auto difficulty=peaceful active=1',
    'peaceful kit off: swords=as_before compost=as_before mode=auto difficulty=easy active=0'])
})

test('THE CLASSIFIER: a compost visit that lost kit plants counts as the composter\'s effect only while the kit is on', () => {
  const delta = { inventory: { wildflowers: -12, melon_slice: -3 }, distance: 0 }
  let on, off
  try { setPeacefulFood(true); on = classifyOutcome('compost', 'success', delta) } finally { setPeacefulFood(false) }
  off = classifyOutcome('compost', 'success', delta)
  assert.match(JSON.stringify(on), /inventory_loss: wildflowers -12, melon_slice -3/)
  assert.doesNotMatch(JSON.stringify(off), /wildflowers/)
})

// ---- the prompt never advises a sword craft the gate refuses --------------------------------------------------------------
test('PROMPT: CAN CRAFT NOW lists no sword while active (the 6-slot line fills with the next tool); lists them again off', async () => {
  const { craftableNow } = await import('../src/prompt.mjs')
  const bot = { registry: mcData, inventory: { items: () => [{ name: 'crafting_table', count: 1 }] }, recipesFor: () => [{}], findBlock: () => null }
  let on
  try { setPeacefulFood(true); on = craftableNow(bot) } finally { setPeacefulFood(false) }
  const off = craftableNow(bot)
  assert.doesNotMatch(on, /_sword/); assert.match(on, /stone_shovel/)
  assert.match(off, /stone_sword/)
})

// ---- the switch in a process of its own (FOOD_SKIP is read when skills.mjs loads) --------------------------------------
test('FOOD_SKIP=off: a peaceful bot banks no sword and is not refused a sword craft (the owner\'s off switch)', () => {
  const src = `
    process.env.LOG_DIR = ${JSON.stringify(process.env.LOG_DIR)}; process.env.POOL_STATE_DIR = ${JSON.stringify(process.env.POOL_STATE_DIR)}
    const { createRequire } = await import('node:module')
    const mc = createRequire(import.meta.url)('minecraft-data')('1.21.8')
    const { AdmissionControl } = await import(${JSON.stringify(new URL('../src/admission.mjs', import.meta.url).href)})
    const { foodSkipNow } = await import(${JSON.stringify(new URL('../src/skills.mjs', import.meta.url).href)})
    const { bankableInventory } = await import(${JSON.stringify(new URL('../src/bankable.mjs', import.meta.url).href)})
    const bot = { registry: mc, serverDifficulty: 'peaceful', entity: { position: { x: 0, y: 64, z: 0 } }, inventory: { items: () => [] }, findBlock: () => null }
    const r = new AdmissionControl().check({ skill: 'craft', args: { item: 'wooden_sword', count: 1 } }, bot)
    foodSkipNow(bot)
    const n = bankableInventory([{ name: 'stone_sword', count: 1, maxDurability: 131, durabilityUsed: 0 }]).count
    console.log('RESULT ' + JSON.stringify({ reason: r.reason ?? null, banked: n }))
  `
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', src],
    { env: { ...process.env, FOOD_SKIP: 'off' }, cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' })
  const res = JSON.parse(/RESULT (.*)/.exec(out)[1])
  assert.notEqual(res.reason, 'peaceful_no_sword'); assert.equal(res.banked, 0)
})
