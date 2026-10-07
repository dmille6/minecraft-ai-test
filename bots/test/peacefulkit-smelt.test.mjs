// THE PEACEFUL KIT AT THE FURNACE (owner 10-07 ~19:50Z): a smelt that is ALREADY happening prefers the carried wooden
// swords the switch calls unwanted as fuel, one per smelted item, before any ordinary fuel; a sword never starts a smelt;
// a sword goes in only to a COLD furnace with an empty fuel slot (it ignites at once, so the switch read at the put is
// the switch at the burn, and no sword ever waits staged); a burn is confirmed by the slot emptying while the furnace
// burns; an unburned sword comes back -- or, with a full bag, stays in the furnace -- and is never tossed.
//
// The fake furnace burns the vanilla way (AbstractFurnaceBlockEntity): one item needs 200 ticks of burn; a fuel unit
// leaves the slot only when the burn left cannot finish the current item; `fuel` is mineflayer's burn-left fraction
// (0 = cold). Its takeFuel TOSSES the item when the bag has no empty slot, as mineflayer's putAway does
// (inventory.js:169-172), so a drop is visible to the test.
process.env.LOG_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'mcbot-pk-smelt-'))
process.env.BOT_NAME = 'SmeltBot'
const assert = (await import('node:assert/strict')).default
const test = (await import('node:test')).default
const { SKILLS, foodSkipNow } = await import('../src/skills.mjs')
const { smeltPlan } = await import('../src/smelting.mjs')
const { tapRecords } = await import('../src/logger.mjs')

const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z) })
const ID = { raw_iron: 1, iron_ingot: 2, coal: 3, furnace: 4, oak_planks: 8, wooden_sword: 10, stone_sword: 11, cobblestone: 12 }
const NAME = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k]))
const TICKS = { coal: 1600, oak_planks: 300, wooden_sword: 200 }

function makeBot (inv, difficulty, { tickMs = 4, onBurn = null, warm = 0, fuelUnknown = false, holdIgnition = false, filler = 0 } = {}) {
  const bag = { ...inv }
  const give = (n, c) => { bag[n] = (bag[n] ?? 0) + c }
  const take = (n, c) => { bag[n] = (bag[n] ?? 0) - c; if (bag[n] <= 0) delete bag[n] }
  const slots = { input: null, fuel: null, output: null }
  const burnt = {}, stagedWhileBurning = [], dropped = []
  let burnLeft = warm, ticker = null
  const tick = () => {
    if (!slots.input) { if (burnLeft > 0) burnLeft = Math.max(0, burnLeft - 200); return }
    while (burnLeft < 200) {
      if (!slots.fuel || holdIgnition) { burnLeft = 0; return }
      const f = slots.fuel.name
      burnLeft += TICKS[f]; burnt[f] = (burnt[f] ?? 0) + 1
      slots.fuel = slots.fuel.count > 1 ? { ...slots.fuel, count: slots.fuel.count - 1 } : null
      onBurn?.(f)
      if (burnLeft < 200) return
    }
    burnLeft -= 200
    slots.input = slots.input.count > 1 ? { ...slots.input, count: slots.input.count - 1 } : null
    slots.output = { name: 'iron_ingot', type: ID.iron_ingot, count: (slots.output?.count ?? 0) + 1 }
  }
  const stacks = () => Object.entries(bag).reduce((n, [k, c]) => n + (/_sword$/.test(k) ? c : Math.ceil(c / 64)), 0) + filler
  const furnace = {
    get fuel () { return fuelUnknown ? null : (burnLeft > 0 ? burnLeft / 1600 : 0) },
    inputItem: () => slots.input, fuelItem: () => slots.fuel, outputItem: () => slots.output,
    async putInput (type, _m, count) { take(NAME[type], count); slots.input = { name: NAME[type], type, count }; ticker ??= setInterval(tick, tickMs) },
    async putFuel (type, _m, count) {
      if ((bag[NAME[type]] ?? 0) < count) throw new Error('not enough to transfer')
      if (slots.fuel && slots.fuel.name !== NAME[type]) throw new Error('fuel slot holds another item')
      if (NAME[type] === 'wooden_sword' && (slots.fuel || count > 1)) throw new Error('a sword does not stack')
      if (NAME[type] === 'wooden_sword' && burnLeft > 0) stagedWhileBurning.push(burnLeft)
      take(NAME[type], count); slots.fuel = { name: NAME[type], type, count: (slots.fuel?.count ?? 0) + count }
    },
    async takeOutput () { assert.ok(slots.output); give('iron_ingot', slots.output.count); slots.output = null },
    async takeInput () { assert.ok(slots.input); give(slots.input.name, slots.input.count); slots.input = null },
    async takeFuel () {
      assert.ok(slots.fuel)
      if (stacks() >= 36 && /_sword$/.test(slots.fuel.name)) dropped.push(slots.fuel.name)   // putAway's tossLeftover
      else give(slots.fuel.name, slots.fuel.count)
      slots.fuel = null
    },
    close () { clearInterval(ticker); ticker = null },
  }
  const bot = {
    entity: { position: V(1, 64, 0), velocity: { y: 0 } }, health: 20, food: 20, serverDifficulty: difficulty,
    registry: { itemsByName: Object.fromEntries(Object.keys(ID).map(n => [n, { id: ID[n], name: n }])),
                items: Object.fromEntries(Object.entries(NAME).map(([id, n]) => [id, { name: n }])), blocks: { 90: { name: 'furnace' } } },
    inventory: { items: () => Object.entries(bag).filter(([, c]) => c > 0).flatMap(([name, count]) =>
      /_sword$/.test(name) ? Array.from({ length: count }, () => ({ name, count: 1, type: ID[name] })) : [{ name, count, type: ID[name] }]),
                 emptySlotCount: () => Math.max(0, 36 - stacks()) },
    findBlock ({ matching }) { const blk = { type: 90, name: 'furnace', position: V(1, 64, 0) }; return matching(blk) ? blk : null },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }),
    async equip () {}, async lookAt () {}, pathfinder: { async goto () {}, setGoal () {}, stop () {} },
    async openFurnace () { return furnace },
  }
  return { bot, bag, slots, burnt, stagedWhileBurning, dropped }
}
const run = (bot, count = 4, signal = new AbortController().signal) => SKILLS.smelt.run({ bot }, { item: 'raw_iron', count }, signal)
const swordRows = async fn => {
  const rows = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_sword_fuel') rows.push(`${r.skill.status}:${r.skill.detail}`) })
  try { return { out: await fn(), rows } } finally { untap() }
}

test('PLAN: swords first, one per item, then ordinary fuel for the rest; zero swords is the old plan exactly', () => {
  const held = { raw_iron: 4, coal: 2, wooden_sword: 2 }
  const old = smeltPlan({ held, item: 'raw_iron', count: 4, budgetMs: 600000 })
  assert.deepEqual(smeltPlan({ held, item: 'raw_iron', count: 4, budgetMs: 600000, swordFuel: 0 }), old)
  const p = smeltPlan({ held, item: 'raw_iron', count: 4, budgetMs: 600000, swordFuel: 2 })
  assert.equal(p.batch, 4); assert.equal(p.swordsUsed, 2)
  assert.deepEqual(p.fuelQueue.map(q => q.name), ['wooden_sword', 'wooden_sword', 'coal'])
  const one = smeltPlan({ held: { raw_iron: 1, coal: 2, wooden_sword: 3 }, item: 'raw_iron', count: 1, budgetMs: 600000, swordFuel: 3 })
  assert.deepEqual(one.fuelQueue.map(q => q.name), ['wooden_sword'], 'one item: one sword, no coal')
  const two = smeltPlan({ held: { raw_iron: 2, coal: 2, wooden_sword: 2 }, item: 'raw_iron', count: 2, budgetMs: 600000, swordFuel: 2 })
  assert.deepEqual(two.fuelQueue.map(q => q.name), ['wooden_sword', 'wooden_sword'], 'a sword smelts ONE item: two items, two swords')
})

test('NEVER STARTS A SMELT: with no ordinary fuel the walk is refused before it starts, swords or not', async () => {
  const { bot, bag } = makeBot({ raw_iron: 2, wooden_sword: 2 }, 'peaceful')
  const r = await run(bot)
  assert.notEqual(r.status, 'success', r.detail)
  assert.match(r.detail, /nothing to burn/)
  assert.equal(bag.wooden_sword, 2, 'no sword burned')
})

test('PEACEFUL: the swords burn first (one per ingot, each into a COLD furnace), coal covers the rest; one confirmed row per burn', async () => {
  const m = makeBot({ raw_iron: 4, coal: 2, wooden_sword: 2, stone_sword: 1 }, 'peaceful')
  const { out: r, rows } = await swordRows(() => run(m.bot))
  assert.equal(r.status, 'success', r.detail)
  assert.equal(m.bag.iron_ingot, 4)
  assert.equal(m.burnt.wooden_sword, 2, JSON.stringify(m.burnt)); assert.equal(m.bag.wooden_sword, undefined)
  assert.equal(m.burnt.coal, 1); assert.equal(m.bag.coal, 1, 'the coal not burned came back')
  assert.equal(m.bag.stone_sword, 1)
  assert.deepEqual(m.stagedWhileBurning, [], 'no sword ever waited in the slot of a burning furnace')
  assert.equal(m.slots.fuel, null); assert.deepEqual(m.dropped, [])
  assert.match(r.detail, /burned .*2x wooden_sword/)
  assert.deepEqual(rows, ['success:burned wooden_sword for raw_iron active=1', 'success:burned wooden_sword for raw_iron active=1'])
})

for (const d of ['easy', undefined]) {
  test(`NOT PEACEFUL (${d}): no sword is fuel -- the old single coal load`, async () => {
    const m = makeBot({ raw_iron: 4, coal: 2, wooden_sword: 2 }, d)
    const r = await run(m.bot)
    assert.equal(r.status, 'success', r.detail)
    assert.equal(m.bag.wooden_sword, 2); assert.equal(m.burnt.wooden_sword, undefined); assert.equal(m.burnt.coal, 1)
  })
}

test('THE SWITCH TURNS OFF during the first sword\'s burn: the second never goes in; ONE ordinary load covers the rest (exact planks)', async () => {
  let bot
  const m = makeBot({ raw_iron: 3, oak_planks: 5, wooden_sword: 2 }, 'peaceful', { onBurn: f => { if (f === 'wooden_sword') bot.serverDifficulty = 'hard' } })
  bot = m.bot
  const r = await run(bot, 3)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(m.burnt.wooden_sword, 1); assert.equal(m.bag.wooden_sword, 1)
  assert.equal(m.bag.iron_ingot, 3, `every ingot made: ${JSON.stringify(m.burnt)} ${r.detail}`)
  foodSkipNow({ serverDifficulty: 'hard' })
})

test('THE SWITCH TURNS OFF with the ordinary load sharing the bag\'s only coal: no double count, no throw (Claude r-rev1)', async () => {
  let bot
  const m = makeBot({ raw_iron: 3, coal: 1, wooden_sword: 2 }, 'peaceful', { onBurn: f => { if (f === 'wooden_sword') bot.serverDifficulty = 'hard' } })
  bot = m.bot
  const r = await run(bot, 3)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(m.bag.iron_ingot, 3); assert.equal(m.burnt.coal, 1); assert.equal(m.bag.wooden_sword, 1)
  foodSkipNow({ serverDifficulty: 'hard' })
})

test('A WARM FURNACE (residual burn from an earlier job): the sword waits until it is cold, never staged while burning', async () => {
  const m = makeBot({ raw_iron: 3, coal: 1, wooden_sword: 1 }, 'peaceful', { warm: 400 })
  const r = await run(m.bot, 3)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(m.stagedWhileBurning, [])
  assert.equal(m.burnt.wooden_sword, 1); assert.equal(m.bag.iron_ingot, 3)
})

test('NO BURN READING from the server: the swords give way to ordinary fuel (no stalled job), and stay in the bag', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 2 }, 'peaceful', { fuelUnknown: true })
  const r = await run(m.bot, 2)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(m.bag.wooden_sword, 2); assert.equal(m.burnt.coal, 1); assert.equal(m.bag.iron_ingot, 2)
})

for (const [why, filler, back] of [['room in the bag', 0, true], ['a FULL bag', 36, false]]) {
  test(`A SWORD THAT NEVER IGNITED (the job stopped) with ${why}: ${back ? 'it comes back' : 'it stays in the furnace'} -- never tossed; the row says so`, async () => {
    const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 1 }, 'peaceful', { holdIgnition: true, filler })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 150)
    const { rows } = await swordRows(() => run(m.bot, 2, ac.signal).then(r => r, e => e))
    assert.deepEqual(m.dropped, [], 'nothing tossed')
    assert.equal(m.burnt.wooden_sword, undefined)
    if (back) { assert.equal(m.bag.wooden_sword, 1); assert.equal(m.slots.fuel, null) }
    else { assert.equal(m.slots.fuel?.name, 'wooden_sword', 'left as fuel in the furnace') }
    assert.deepEqual(rows, [back ? 'no_effect:wooden_sword returned unburned for raw_iron active=1'
                                 : 'no_effect:wooden_sword left in the furnace fuel slot (the bag is full) for raw_iron active=1'])
  })
}
