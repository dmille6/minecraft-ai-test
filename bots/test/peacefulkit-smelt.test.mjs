// THE PEACEFUL KIT AT THE FURNACE (owner 10-07 ~19:50Z): a smelt that is ALREADY happening prefers the carried wooden
// swords the switch calls unwanted as fuel, one per smelted item, before any ordinary fuel; a sword never starts a smelt;
// the switch is read again before each sword goes in; nothing is ever dropped.
//
// The fake furnace burns fuel the vanilla way (AbstractFurnaceBlockEntity): when nothing is burning and there is input,
// ONE item leaves the fuel slot and burns for its ticks (wooden sword 200, coal 1600, planks 300); one item smelts per 200
// ticks of burn. So a sword in the fuel slot is consumed the moment it ignites and the slot reads empty -- which is what
// the skill's refuel step waits for.
process.env.LOG_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'mcbot-pk-smelt-'))
process.env.BOT_NAME = 'SmeltBot'
const assert = (await import('node:assert/strict')).default
const test = (await import('node:test')).default
const { SKILLS, foodSkipNow } = await import('../src/skills.mjs')
const { smeltPlan } = await import('../src/smelting.mjs')
const { tapRecords } = await import('../src/logger.mjs')

const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z) })
const ID = { raw_iron: 1, iron_ingot: 2, coal: 3, furnace: 4, oak_planks: 8, wooden_sword: 10, stone_sword: 11 }
const NAME = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k]))
const TICKS = { coal: 1600, oak_planks: 300, wooden_sword: 200 }

function makeBot (inv, difficulty, { tickMs = 4, onBurn = null } = {}) {
  const bag = { ...inv }
  const give = (n, c) => { bag[n] = (bag[n] ?? 0) + c }
  const take = (n, c) => { bag[n] = (bag[n] ?? 0) - c; if (bag[n] <= 0) delete bag[n] }
  const slots = { input: null, fuel: null, output: null }
  const burnt = {}
  let burnLeft = 0, ticker = null
  const tick = () => {
    if (!slots.input) return
    if (burnLeft <= 0) {
      if (!slots.fuel) return
      const f = slots.fuel.name
      burnLeft += TICKS[f]; burnt[f] = (burnt[f] ?? 0) + 1
      slots.fuel = slots.fuel.count > 1 ? { ...slots.fuel, count: slots.fuel.count - 1 } : null
      onBurn?.(f)
    }
    burnLeft -= 200
    slots.input = slots.input.count > 1 ? { ...slots.input, count: slots.input.count - 1 } : null
    slots.output = { name: 'iron_ingot', type: ID.iron_ingot, count: (slots.output?.count ?? 0) + 1 }
  }
  const furnace = {
    inputItem: () => slots.input, fuelItem: () => slots.fuel, outputItem: () => slots.output,
    async putInput (type, _m, count) { take(NAME[type], count); slots.input = { name: NAME[type], type, count }; ticker ??= setInterval(tick, tickMs) },
    async putFuel (type, _m, count) {
      if ((bag[NAME[type]] ?? 0) < count) throw new Error('not enough to transfer')
      if (slots.fuel && slots.fuel.name !== NAME[type]) throw new Error('fuel slot holds another item')
      if (NAME[type] === 'wooden_sword' && (slots.fuel || count > 1)) throw new Error('a sword does not stack')
      take(NAME[type], count); slots.fuel = { name: NAME[type], type, count: (slots.fuel?.count ?? 0) + count }
    },
    async takeOutput () { assert.ok(slots.output); give('iron_ingot', slots.output.count); slots.output = null },
    async takeInput () { assert.ok(slots.input); give(slots.input.name, slots.input.count); slots.input = null },
    async takeFuel () { assert.ok(slots.fuel); give(slots.fuel.name, slots.fuel.count); slots.fuel = null },
    close () { clearInterval(ticker); ticker = null },
  }
  const bot = {
    entity: { position: V(1, 64, 0), velocity: { y: 0 } }, health: 20, food: 20, serverDifficulty: difficulty,
    registry: { itemsByName: Object.fromEntries(Object.keys(ID).map(n => [n, { id: ID[n], name: n }])),
                items: Object.fromEntries(Object.entries(NAME).map(([id, n]) => [id, { name: n }])), blocks: { 90: { name: 'furnace' } } },
    inventory: { items: () => Object.entries(bag).filter(([, c]) => c > 0).flatMap(([name, count]) =>
      /_sword$/.test(name) ? Array.from({ length: count }, () => ({ name, count: 1, type: ID[name] })) : [{ name, count, type: ID[name] }]) },
    findBlock ({ matching }) { const blk = { type: 90, name: 'furnace', position: V(1, 64, 0) }; return matching(blk) ? blk : null },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }),
    async equip () {}, async lookAt () {}, pathfinder: { async goto () {}, setGoal () {}, stop () {} },
    async openFurnace () { return furnace },
  }
  return { bot, bag, slots, burnt }
}
const run = bot => SKILLS.smelt.run({ bot }, { item: 'raw_iron', count: 4 }, new AbortController().signal)

test('PLAN: swords first, one per item, then ordinary fuel for the rest; zero swords is the old plan exactly', () => {
  const held = { raw_iron: 4, coal: 2, wooden_sword: 2 }
  const old = smeltPlan({ held, item: 'raw_iron', count: 4, budgetMs: 600000 })
  assert.deepEqual(smeltPlan({ held, item: 'raw_iron', count: 4, budgetMs: 600000, swordFuel: 0 }), old)
  const p = smeltPlan({ held, item: 'raw_iron', count: 4, budgetMs: 600000, swordFuel: 2 })
  assert.equal(p.batch, 4); assert.equal(p.swordsUsed, 2)
  assert.deepEqual(p.fuelQueue.map(q => q.name), ['wooden_sword', 'wooden_sword', 'coal'])
  const one = smeltPlan({ held: { raw_iron: 1, coal: 2, wooden_sword: 3 }, item: 'raw_iron', count: 1, budgetMs: 600000, swordFuel: 3 })
  assert.deepEqual(one.fuelQueue.map(q => q.name), ['wooden_sword'], 'one item: one sword, no coal')
})

test('NEVER STARTS A SMELT: with no ordinary fuel the walk is refused before it starts, swords or not', async () => {
  const { bot, bag } = makeBot({ raw_iron: 2, wooden_sword: 2 }, 'peaceful')
  const r = await run(bot)
  assert.notEqual(r.status, 'success', r.detail)
  assert.match(r.detail, /nothing to burn/)
  assert.equal(bag.wooden_sword, 2, 'no sword burned')
})

test('PEACEFUL: the swords burn first (one per ingot), coal covers the rest; stone swords untouched; one _sword_fuel row per sword', async () => {
  const rows = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_sword_fuel') rows.push(r.skill.detail) })
  const { bot, bag, burnt, slots } = makeBot({ raw_iron: 4, coal: 2, wooden_sword: 2, stone_sword: 1 }, 'peaceful')
  let r
  try { r = await run(bot) } finally { untap() }
  assert.equal(r.status, 'success', r.detail)
  assert.equal(bag.iron_ingot, 4)
  assert.equal(burnt.wooden_sword, 2, JSON.stringify(burnt)); assert.equal(bag.wooden_sword, undefined)
  assert.equal(burnt.coal, 1); assert.equal(bag.coal, 1, 'the coal not burned came back')
  assert.equal(bag.stone_sword, 1)
  assert.equal(slots.fuel, null, 'nothing left in the furnace')
  assert.match(r.detail, /burned 2x wooden_sword \+ 1x coal/)
  assert.deepEqual(rows, ['wooden_sword into the furnace fuel slot for raw_iron active=1', 'wooden_sword into the furnace fuel slot for raw_iron active=1'])
})

for (const d of ['easy', undefined]) {
  test(`NOT PEACEFUL (${d}): no sword is fuel -- the old single coal load`, async () => {
    const { bot, bag, burnt } = makeBot({ raw_iron: 4, coal: 2, wooden_sword: 2 }, d)
    const r = await run(bot)
    assert.equal(r.status, 'success', r.detail)
    assert.equal(bag.wooden_sword, 2); assert.equal(burnt.wooden_sword, undefined); assert.equal(burnt.coal, 1)
  })
}

test('THE SWITCH IS READ AT EACH BURN: the world turns easy after the first sword -> the second stays in the bag, coal covers its item', async () => {
  let bot
  const made = makeBot({ raw_iron: 4, coal: 2, wooden_sword: 2 }, 'peaceful', { onBurn: f => { if (f === 'wooden_sword') bot.serverDifficulty = 'easy' } })
  bot = made.bot
  const r = await run(bot)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(made.burnt.wooden_sword, 1, 'only the sword loaded while the switch was on')
  assert.equal(made.bag.wooden_sword, 1, 'the second sword is still in the bag')
  assert.equal(made.bag.iron_ingot, 4, 'and every ingot was still made')
  foodSkipNow({ serverDifficulty: 'hard' })
})
