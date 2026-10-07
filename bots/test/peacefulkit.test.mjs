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
  'sunflower', 'lilac', 'rose_bush', 'peony', 'wildflowers', 'pink_petals', 'cactus_flower',
  // the owner's 10-07 ~19:50Z additions, consumed 64/64 in the same Paper hopper test
  'dried_kelp', 'glow_berries', 'moss_carpet', 'firefly_bush', 'bush', 'bread']
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
  for (const n of ['apple', 'carrot', 'potato', 'cookie', 'short_dry_grass', 'oak_sapling', 'bone_meal'])
    assert.equal(K.isPeacefulCompost(n), false, `${n} was not approved`)
  assert.equal(K.PEACEFUL_COMPOST.melon_slice, 0.5); assert.equal(K.PEACEFUL_COMPOST.torchflower, 0.85); assert.equal(K.PEACEFUL_COMPOST.wildflowers, 0.3)
  assert.equal(K.PEACEFUL_COMPOST.bread, 0.85); assert.equal(K.PEACEFUL_COMPOST.dried_kelp, 0.3)
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
  // THE CLASSIFICATION junkwell-02 imports: any sword, only while the switch is on
  for (const n of ['wooden_sword', 'stone_sword', 'iron_sword', 'netherite_sword']) {
    assert.equal(K.unwantedSword({ name: n }, true), true, n); assert.equal(K.unwantedSword({ name: n }, false), false, n)
  }
  for (const n of ['stone_pickaxe', 'stick', undefined]) assert.equal(K.unwantedSword({ name: n }, true), false, String(n))
  assert.equal(K.unwantedSword(null, true), false)
  assert.equal(K.burnableSword({ name: 'wooden_sword' }, true), true)
  assert.equal(K.burnableSword({ name: 'wooden_sword' }, false), false, 'off: a wooden sword is a tool')
  assert.equal(K.burnableSword({ name: 'stone_sword' }, true), false, 'stone does not burn: it stays for the well')
  assert.equal(K.swordFuelCount([T('wooden_sword'), T('wooden_sword', 50, 10), T('stone_sword', 0, 11), stack('coal', 3)], true), 2)
  assert.equal(K.swordFuelCount([T('wooden_sword')], false), 0)
})

// ---- the composer: pure ------------------------------------------------------------------------------------------------
const S = (name, count, slot) => ({ name, count, slot })
const T = (name, used = 0, slot = 9) => ({ name, count: 1, slot, maxDurability: { wooden: 59, stone: 131, iron: 250 }[name.split('_')[0]] ?? 131, durabilityUsed: used })
const KITBAG = () => [S('wildflowers', 40, 9), S('melon_slice', 9, 10), S('kelp', 12, 11), S('brown_mushroom', 2, 12), S('red_tulip', 1, 13),
  S('cocoa_beans', 3, 14), S('torchflower_seeds', 2, 15), S('apple', 10, 16), S('oak_sapling', 20, 17), S('birch_sapling', 8, 18),
  S('leaf_litter', 5, 19), S('bread', 5, 20), S('dried_kelp', 4, 21), S('stone_sword', 1, 22), S('wooden_sword', 1, 23),
  S('spruce_sapling', 7, 24), S('jungle_sapling', 20, 25), S('carrot', 3, 26)]

test('OFF IS TODAY: without `plants` the allowance, plan and next insert are exactly the old ones (the kit plants stay)', () => {
  const bag = KITBAG()
  assert.deepEqual(C.compostAllowance(bag), C.compostAllowance(bag, { apples: false, plants: false }))
  assert.deepEqual(C.compostAllowance(bag), { oak_sapling: 4, leaf_litter: 5, jungle_sapling: 4 }, 'off: 16 of EVERY species kept')
  assert.deepEqual(C.compostAllowance(bag, { apples: true }), { oak_sapling: 4, leaf_litter: 5, jungle_sapling: 4, apple: 6 }, 'the food policy alone: apples, no plants')
  assert.deepEqual(C.compostPlan(bag), C.compostPlan(bag, { plants: false }))
})

test('ON: every kit plant WHOLE (bread and dried_kelp too), oak/birch above 16, OTHER saplings all, apples above 4; swords and carrots never', () => {
  const allow = C.compostAllowance(KITBAG(), { apples: true, plants: true })
  assert.deepEqual(allow, { wildflowers: 40, melon_slice: 9, kelp: 12, brown_mushroom: 2, red_tulip: 1, cocoa_beans: 3, torchflower_seeds: 2,
    apple: 6, oak_sapling: 4, leaf_litter: 5, bread: 5, dried_kelp: 4, spruce_sapling: 7, jungle_sapling: 20 })
  for (const sp of ['spruce', 'jungle', 'acacia', 'dark_oak', 'cherry', 'pale_oak']) {
    assert.equal(K.peacefulSaplingReserve(`${sp}_sapling`), 0, sp)
    assert.equal(C.compostAllowance([S(`${sp}_sapling`, 3)], { plants: true })[`${sp}_sapling`], 3, `${sp}: every one goes`)
  }
  for (const sp of ['oak', 'birch']) assert.equal(C.compostAllowance([S(`${sp}_sapling`, 16)], { plants: true })[`${sp}_sapling`], undefined, `${sp}: 16 kept`)
  assert.equal(K.peacefulSaplingReserve('mangrove_propagule'), null, 'not a sapling name: never composted (NEVER_COMPOST)')
  assert.equal(C.compostAllowance([S('wildflowers', 64)], { plants: false }).wildflowers, undefined)
})

test('ON, insert by insert to the end (room every time): no kit plant, no spruce/jungle, 16 oak, 4 apples, both swords, the carrots', () => {
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
  assert.equal(left.stone_sword, 1); assert.equal(left.wooden_sword, 1); assert.equal(left.carrot, 3)
  assert.equal(left.spruce_sapling, undefined); assert.equal(left.jungle_sapling, undefined)
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
  // THE REAL SURPLUS AFTER EVERY RESERVE (owner 10-07): 4 apples and 16 oak saplings ARE compostable things, but the
  // reserves take them all -- surplus 0, no trip, even with a free slot
  const kept = [S('apple', 4, 9), S('oak_sapling', 16, 10), ...fill(30)]
  assert.equal(C.startableJunk(kept, { apples: true, plants: true }), 0)
})

// ---- the bank: pure (OWNER 10-07 ~19:50Z: "no reason to store swords at all") ------------------------------------------
test('BANK pure: while on NO sword is bankable, not even a spare; off the old one-per-name rule; pickaxes unchanged', () => {
  const bag = [T('stone_sword', 0, 9), T('stone_sword', 0, 10), T('wooden_sword', 0, 11), T('stone_pickaxe', 30, 12), T('stone_pickaxe', 5, 13), stack('cobblestone', 64)]
  const on = depositPlan(bag, null, { noSwords: true }), off = depositPlan(bag, null, { noSwords: false })
  const n = (plan, name) => plan.find(e => e.name === name)?.count ?? 0
  assert.equal(n(on, 'stone_sword') + n(on, 'wooden_sword'), 0, 'on: none')
  assert.equal(n(off, 'stone_sword'), 1, 'off: the spare goes, as today'); assert.equal(n(off, 'wooden_sword'), 0)
  assert.equal(n(on, 'stone_pickaxe'), n(off, 'stone_pickaxe'), 'pickaxes: the same rule either way')
  assert.equal(bankableInventory(bag, { noSwords: true }).excluded.stone_sword, 'peaceful_sword')
  assert.deepEqual(depositPlan(bag, null), off, 'the default is the base rule')
})

test('BANK: a named `deposit stone_sword` while on says why nothing moves (no digits, the rule first)', async () => {
  const { depositNoopReason } = await import('../src/bankable.mjs')
  const r = depositNoopReason([T('stone_sword'), T('stone_sword', 0, 10)], 'stone_sword', { noSwords: true })
  assert.match(r, /^not a banking target \(swords are not banked in a peaceful world\)/)
  assert.doesNotMatch(r, /\d/)
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

for (const [why, difficulty, spare] of [['PEACEFUL', 'peaceful', 0], ['EASY world', 'easy', 1], ['difficulty unknown', undefined, 1]]) {
  test(`DEPOSIT WIRED, ${why}: an unnamed deposit ${spare ? 'banks the SPARE stone sword (the old rule)' : 'banks NO sword, not even the spare'}; the best pickaxe stays; nothing dropped`, async () => {
    const w = townWith([tool('stone_sword'), tool('stone_sword'), tool('wooden_sword'), tool('stone_pickaxe', 30), tool('stone_pickaxe', 100), stack('cobblestone', 64), stack('oak_log', 30)], difficulty)
    const r = await runDeposit(w.bot)
    assert.equal(r.status, 'success', r.detail)
    assert.equal(inChest(w, 'stone_sword') + inChest(w, 'wooden_sword'), spare)
    assert.equal(inBag(w, 'stone_sword') + inBag(w, 'wooden_sword'), 3 - spare)
    assert.equal(inBag(w, 'stone_pickaxe'), 1, 'one pickaxe kept')
    assert.equal(w.bag.find(s => s?.name === 'stone_pickaxe')?.durabilityUsed, 30, 'the BEST pickaxe is the one kept')
    assert.deepEqual(w.dropped, [], 'never dropped')
  })
}

test('ADMISSION: a NAMED sword deposit is refused before the walk while on (the rule named); admitted off as today', () => {
  for (const [d, refused] of [['peaceful', true], ['easy', false]]) {
    const w = townWith([tool('stone_sword'), tool('stone_sword'), stack('cobblestone', 64)], d)
    const r = new AdmissionControl().check({ skill: 'deposit', args: { item: 'stone_sword' } }, w.bot)
    assert.equal(r.reason === 'peaceful_sword_deposit', refused, `${d}: ${JSON.stringify(r)}`)
    if (refused) assert.match(r.detail, /^not a banking target \(swords are not banked in a peaceful world\)/)
  }
  setPeacefulFood(false)
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
    'peaceful kit ON: swords=no_bank,no_craft,no_chase,burn_wooden compost=plants mode=auto difficulty=peaceful active=1',
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
test('FOOD_SKIP=off: a peaceful bot is not refused a sword craft, its spare sword banks as today, no sword is fuel (the owner\'s off switch)', () => {
  const src = `
    process.env.LOG_DIR = ${JSON.stringify(process.env.LOG_DIR)}; process.env.POOL_STATE_DIR = ${JSON.stringify(process.env.POOL_STATE_DIR)}
    const { createRequire } = await import('node:module')
    const mc = createRequire(import.meta.url)('minecraft-data')('1.21.8')
    const { AdmissionControl } = await import(${JSON.stringify(new URL('../src/admission.mjs', import.meta.url).href)})
    const { foodSkipNow } = await import(${JSON.stringify(new URL('../src/skills.mjs', import.meta.url).href)})
    const { bankableInventory } = await import(${JSON.stringify(new URL('../src/bankable.mjs', import.meta.url).href)})
    const { swordFuelCount } = await import(${JSON.stringify(new URL('../src/peacefulkit.mjs', import.meta.url).href)})
    const bot = { registry: mc, serverDifficulty: 'peaceful', entity: { position: { x: 0, y: 64, z: 0 } }, inventory: { items: () => [] }, findBlock: () => null }
    const r = new AdmissionControl().check({ skill: 'craft', args: { item: 'wooden_sword', count: 1 } }, bot)
    const on = foodSkipNow(bot).active
    const sw = { name: 'stone_sword', count: 1, maxDurability: 131, durabilityUsed: 0 }
    const n = bankableInventory([sw, { ...sw }], { noSwords: on }).count
    const fuel = swordFuelCount([{ name: 'wooden_sword', count: 1 }], on)
    console.log('RESULT ' + JSON.stringify({ reason: r.reason ?? null, banked: n, on, fuel }))
  `
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', src],
    { env: { ...process.env, FOOD_SKIP: 'off' }, cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' })
  const res = JSON.parse(/RESULT (.*)/.exec(out)[1])
  assert.notEqual(res.reason, 'peaceful_no_sword'); assert.equal(res.on, false); assert.equal(res.banked, 1); assert.equal(res.fuel, 0)
})
