// THE PEACEFUL KIT AT THE FURNACE (owner 10-07 ~19:50Z): a smelt that is ALREADY happening prefers the carried wooden
// swords the switch calls unwanted as fuel, one per smelted item, before any ordinary fuel; a sword never starts a smelt;
// a sword goes in only to a COLD furnace with an empty fuel slot (it ignites at once, so the switch read at the put is
// the switch at the burn, and no sword ever waits staged); a burn is confirmed by the slot emptying while the furnace
// burns; an unburned sword comes back -- or, with a full bag, stays in the furnace -- and is never tossed.
//
// The fake furnace burns the vanilla way (AbstractFurnaceBlockEntity): one item needs 200 ticks of burn; a fuel unit
// leaves the slot only when the burn left cannot finish the current item; `fuel` is mineflayer's burn-left fraction
// (0 = cold). Its takeFuel TOSSES the item when the bag has no empty slot, as mineflayer's putAway does
// (inventory.js:169-172), so a drop is visible to the test. AND, AS IN MINEFLAYER (Claude r-rev3), bot.inventory is
// FROZEN while the window is open: slot updates go to the window (furnace.items / emptySlotCount, the live bag) and are
// copied into bot.inventory only at close() -- so code that reads bot.inventory mid-job sees the bag as it was at the open.
process.env.LOG_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'mcbot-pk-smelt-'))
process.env.BOT_NAME = 'SmeltBot'
const assert = (await import('node:assert/strict')).default
const test = (await import('node:test')).default
const { SKILLS, foodSkipNow, swordDrainRow } = await import('../src/skills.mjs')
const { smeltPlan } = await import('../src/smelting.mjs')
const { tapRecords } = await import('../src/logger.mjs')

const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z) })
const ID = { raw_iron: 1, iron_ingot: 2, coal: 3, furnace: 4, oak_planks: 8, wooden_sword: 10, stone_sword: 11, cobblestone: 12 }
const NAME = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k]))
const TICKS = { coal: 1600, oak_planks: 300, wooden_sword: 200 }

function makeBot (inv, difficulty, opts = {}) {
  let { tickMs = 4, onBurn = null, warm = 0, fuelUnknown = false, litUnknown = false, holdIgnition = false, filler = 0, onSwordPut = null, litLagMs = 0 } = opts
  let litSince = 0
  const bag = { ...inv }
  const give = (n, c) => { bag[n] = (bag[n] ?? 0) + c }
  const take = (n, c) => { bag[n] = (bag[n] ?? 0) - c; if (bag[n] <= 0) delete bag[n] }
  const slots = { input: null, fuel: null, output: null }
  const burnt = {}, stagedWhileBurning = [], dropped = [], putFails = []
  let burnLeft = warm, ticker = null
  const tick = () => {
    if (!slots.input) { if (burnLeft > 0) burnLeft = Math.max(0, burnLeft - 200); return }
    while (burnLeft < 200) {
      if (!slots.fuel || holdIgnition) { burnLeft = 0; return }
      const f = slots.fuel.name
      burnLeft += TICKS[f]; burnt[f] = (burnt[f] ?? 0) + 1; litSince = Date.now()
      slots.fuel = slots.fuel.count > 1 ? { ...slots.fuel, count: slots.fuel.count - 1 } : null
      onBurn?.(f)
      if (burnLeft < 200) return
    }
    if (noCook) return            // the burn runs but the item has not cooked yet
    burnLeft -= 200
    slots.input = slots.input.count > 1 ? { ...slots.input, count: slots.input.count - 1 } : null
    slots.output = { name: 'iron_ingot', type: ID.iron_ingot, count: (slots.output?.count ?? 0) + 1 }
  }
  let noCook = opts.noCook ?? false
  const liftFails = opts.liftFails ?? 0           // the next N sword takes lift onto the cursor and then throw
  let lifts = liftFails
  const clickFails = opts.clickFails ?? (() => false)   // (slot) -> true: that click throws
  const stacks = (b = bag, f = filler) => Object.entries(b).reduce((n, [k, c]) => n + (/_sword$/.test(k) ? c : Math.ceil(c / 64)), 0) + f
  const view = b => Object.entries(b).filter(([, c]) => c > 0).flatMap(([name, count]) =>
    /_sword$/.test(name) ? Array.from({ length: count }, () => ({ name, count: 1, type: ID[name] })) : [{ name, count, type: ID[name] }])
  let open = false, frozen = null, frozenFiller = 0      // bot.inventory's copy while the window is open
  const furnace = {
    get fuel () { return fuelUnknown ? null : (burnLeft > 0 ? burnLeft / 1600 : 0) },
    inputItem: () => slots.input, fuelItem: () => slots.fuel, outputItem: () => slots.output,
    async putInput (type, _m, count) { take(NAME[type], count); slots.input = { name: NAME[type], type, count }; ticker ??= setInterval(tick, tickMs) },
    async putFuel (type, _m, count) {
      if ((bag[NAME[type]] ?? 0) < count) { putFails.push(NAME[type]); throw new Error('not enough to transfer') }
      if (slots.fuel && slots.fuel.name !== NAME[type]) { putFails.push(NAME[type]); throw new Error('fuel slot holds another item') }
      if (NAME[type] === 'wooden_sword' && (slots.fuel || count > 1)) throw new Error('a sword does not stack')
      if (NAME[type] === 'wooden_sword' && burnLeft > 0) stagedWhileBurning.push(burnLeft)
      take(NAME[type], count); slots.fuel = { name: NAME[type], type, count: (slots.fuel?.count ?? 0) + count }
      if (NAME[type] === 'wooden_sword') onSwordPut?.({ setFiller: n => { filler = n } })
    },
    async takeOutput () {
      assert.ok(slots.output)
      if (opts.liftOutput) { furnace.selectedItem = { ...slots.output }; slots.output = null; throw new Error('the second click timed out') }
      give('iron_ingot', slots.output.count); slots.output = null
    },
    async takeInput () { assert.ok(slots.input); give(slots.input.name, slots.input.count); slots.input = null },
    async takeFuel () {
      assert.ok(slots.fuel)
      if (opts.fuelHang && /_sword$/.test(slots.fuel.name)) return new Promise(() => {})   // never answers, moves nothing
      if (opts.liftHang && /_sword$/.test(slots.fuel.name)) { furnace.selectedItem = { ...slots.fuel }; slots.fuel = null; filler = 36; return new Promise(() => {}) }
      if (lifts > 0 && /_sword$/.test(slots.fuel.name)) { lifts -= 1; furnace.selectedItem = { ...slots.fuel }; slots.fuel = null; if (opts.fillOnLift) filler = 36; throw new Error('the second click timed out') }
      if (stacks() >= 36 && /_sword$/.test(slots.fuel.name)) dropped.push(slots.fuel.name)   // putAway's tossLeftover
      else give(slots.fuel.name, slots.fuel.count)
      slots.fuel = null
    },
    items: () => view(bag), emptySlotCount: () => Math.max(0, 36 - stacks()),
    selectedItem: null, inventoryStart: 3, inventoryEnd: 39,
    findItemRange: () => null, firstEmptySlotRange: () => (stacks() < 36 ? 9 : null),
    // vanilla's close (Paper probe): a cursor item goes back into the bag when it has room, and is DROPPED when it is full
    close () { clearInterval(ticker); ticker = null; open = false; if (furnace.selectedItem) { if (stacks() < 36) give(furnace.selectedItem.name, furnace.selectedItem.count ?? 1); else dropped.push(furnace.selectedItem.name); furnace.selectedItem = null } },
  }
  const bot = {
    entity: { position: V(1, 64, 0), velocity: { y: 0 } }, health: 20, food: 20, serverDifficulty: difficulty,
    registry: { itemsByName: Object.fromEntries(Object.keys(ID).map(n => [n, { id: ID[n], name: n }])),
                items: Object.fromEntries(Object.entries(NAME).map(([id, n]) => [id, { name: n }])), blocks: { 90: { name: 'furnace' } } },
    inventory: { items: () => view(open ? frozen : bag),
                 emptySlotCount: () => Math.max(0, 36 - (open ? stacks(frozen, frozenFiller) : stacks())) },
    findBlock ({ matching }) { const blk = { type: 90, name: 'furnace', position: V(1, 64, 0) }; return matching(blk) ? blk : null },
    // the furnace block's `lit` state (what the skill reads when mineflayer's furnace.fuel was never reported)
    blockAt: p => (p.x === 1 && p.y === 64 && p.z === 0
      ? { name: 'furnace', position: p, boundingBox: 'block', getProperties: () => (litUnknown ? {} : { lit: burnLeft > 0 && Date.now() - litSince >= litLagMs ? 'true' : 'false' }) }
      : { name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }),
    async equip () {}, async lookAt () {}, pathfinder: { async goto () {}, setGoal () {}, stop () {} },
    async clickWindow (slot) {
      const sel = furnace.selectedItem
      if (!sel) return
      if (clickFails(slot)) throw new Error(`click ${slot} unanswered`)
      if (slot === 1) { if (slots.fuel) throw new Error('fuel slot taken'); slots.fuel = sel }
      else if (slot === 0) { if (slots.input) throw new Error('input slot taken'); slots.input = sel }
      else give(sel.name, sel.count ?? 1)
      furnace.selectedItem = null
    },
    async openFurnace () { open = true; frozen = { ...bag }; frozenFiller = filler; return furnace },
  }
  return { bot, bag, slots, burnt, stagedWhileBurning, dropped, putFails, setFiller: n => { filler = n }, setHold: v => { holdIgnition = v } }
}
const run = (bot, count = 4, signal = new AbortController().signal) => SKILLS.smelt.run({ bot }, { item: 'raw_iron', count }, signal)
const swordRows = async fn => {
  const rows = []
  const held = []      // the wooden swords each row's snapshot lists
  const untap = tapRecords(r => { if (r?.skill?.name === '_sword_fuel') { rows.push(`${r.skill.status}:${r.skill.detail}`); held.push(r?.bot?.inventory?.wooden_sword ?? 0) } })
  try { return { out: await fn(), rows, held } } finally { untap() }
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
  const { out: r, rows, held } = await swordRows(() => run(m.bot))
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(held, [0, 0], 'each burn row is written after the close: its snapshot no longer lists the burned swords (Claude r-rev3)')
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
  // SLOW COOKING (one item per 450 ms): the coal ignites and empties its slot while an item is still raw, so a queue that
  // still held a second ordinary load WOULD ask for it -- the double count is visible, not hidden by a fast furnace.
  const m = makeBot({ raw_iron: 3, coal: 1, wooden_sword: 2 }, 'peaceful', { tickMs: 450, onBurn: f => { if (f === 'wooden_sword') bot.serverDifficulty = 'hard' } })
  bot = m.bot
  const r = await run(bot, 3)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(m.bag.iron_ingot, 3); assert.equal(m.burnt.coal, 1); assert.equal(m.bag.wooden_sword, 1)
  assert.deepEqual(m.putFails, [], 'no load was asked for that the bag could not give (the coal was not counted twice)')
  foodSkipNow({ serverDifficulty: 'hard' })
})

test('A WARM FURNACE (residual burn from an earlier job): the sword waits until it is cold, never staged while burning', async () => {
  const m = makeBot({ raw_iron: 3, coal: 1, wooden_sword: 1 }, 'peaceful', { warm: 400 })
  const r = await run(m.bot, 3)
  assert.equal(r.status, 'success', r.detail)
  assert.deepEqual(m.stagedWhileBurning, [])
  assert.equal(m.burnt.wooden_sword, 1); assert.equal(m.bag.iron_ingot, 3)
})

test('MINEFLAYER NEVER REPORTS furnace.fuel (Paper, 10-07): the block\'s `lit` state says cold, and the swords burn', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 2 }, 'peaceful', { fuelUnknown: true })
  const r = await run(m.bot, 2)
  assert.equal(r.status, 'success', r.detail)
  assert.equal(m.burnt.wooden_sword, 2); assert.equal(m.bag.iron_ingot, 2); assert.deepEqual(m.stagedWhileBurning, [])
})

test('NO BURN READING AT ALL (no fuel, no lit): the swords give way to ordinary fuel (no stalled job), and stay in the bag', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 2 }, 'peaceful', { fuelUnknown: true, litUnknown: true })
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

test('ONE EMPTY SLOT, then the returned input takes it: the unburned sword is NOT taken (it would be tossed) -- it stays in the furnace (both reviews r-rev2)', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 1 }, 'peaceful', { holdIgnition: true, filler: 0,
    onSwordPut: f => f.setFiller(34) })   // pickups at the furnace: coal 1 stack + 34 = 35 -> ONE empty slot, which the returned input takes
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 150)
  const { rows } = await swordRows(() => run(m.bot, 2, ac.signal).then(r => r, e => e))
  assert.deepEqual(m.dropped, [], 'nothing tossed')
  assert.equal(m.bag.raw_iron, 2, 'the input came back into the last slot')
  assert.equal(m.slots.fuel?.name, 'wooden_sword', 'the sword stayed in the furnace')
  assert.deepEqual(rows, ['no_effect:wooden_sword left in the furnace fuel slot (the bag is full) for raw_iron active=1'])
})

test('AN ABORT WITHIN A TICK OF THE PUT, the burn reported late: a burned row (confirmed or marked unconfirmed), never "returned", never no row (Claude r-rev2)', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 1 }, 'peaceful', { fuelUnknown: true, litLagMs: 1000, tickMs: 20 })
  const ac = new AbortController()
  m.bot.openFurnace = (orig => async () => { const f = await orig(); const put = f.putFuel; f.putFuel = async (...a) => { await put(...a); if (a[0] === 10) setTimeout(() => ac.abort(), 1) }; return f })(m.bot.openFurnace)
  const { rows } = await swordRows(() => run(m.bot, 2, ac.signal).then(r => r, e => e))
  assert.equal(m.burnt.wooden_sword, 1, 'the sword did burn')
  assert.equal(rows.length, 1, JSON.stringify(rows))
  assert.match(rows[0], /^success:burned wooden_sword/)
  assert.deepEqual(m.dropped, [])
})

test('A SWORD LEFT IN THE FUEL SLOT BY AN EARLIER CALL (Codex r-rev3): the next call -- switch off -- never burns it and never tosses it', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 1 }, 'peaceful', { holdIgnition: true, filler: 36 })
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 150)
  await run(m.bot, 2, ac.signal).then(r => r, e => e)
  assert.equal(m.slots.fuel?.name, 'wooden_sword', 'first call: left in the furnace (the bag is full)')
  // the next call, the world no longer peaceful, the bag still full: the job does not start; nothing burns, nothing drops
  m.bot.serverDifficulty = 'easy'
  const { out: r2, rows: rows2 } = await swordRows(() => run(m.bot, 2))
  assert.equal(r2.status, 'failed'); assert.equal(r2.failClass, 'inventory_full'); assert.match(r2.detail, /free one slot/); assert.match(r2.detail, /place the furnace you carry/)
  assert.deepEqual(m.dropped, []); assert.equal(m.burnt.wooden_sword, undefined); assert.equal(m.slots.fuel?.name, 'wooden_sword')
  assert.deepEqual(rows2, [])
  // with room: it is taken back BEFORE any input goes in, so it cannot ignite under the switch that turned off; the coal smelts
  m.setHold(false)
  m.bot.openFurnace = (orig => async () => { const f = await orig(); m.setFiller(0); return f })(m.bot.openFurnace)
  const { out: r3, rows: rows3 } = await swordRows(() => run(m.bot, 2))
  assert.equal(r3.status, 'success', r3.detail)
  assert.equal(m.burnt.wooden_sword, undefined, 'never burned with the switch off'); assert.equal(m.bag.wooden_sword, 1)
  assert.deepEqual(m.dropped, [])
  assert.deepEqual(rows3, ['no_effect:wooden_sword returned unburned (left by an earlier call) for raw_iron active=0'])
  foodSkipNow({ serverDifficulty: 'hard' })
})

test('THE FURNACE VANISHES after the put, before ignition (Codex r-rev3): no burn is claimed -- the outcome is unknown', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 1 }, 'peaceful', { holdIgnition: true })
  const ac = new AbortController()
  m.bot.openFurnace = (orig => async () => {
    const f = await orig(); const put = f.putFuel
    f.putFuel = async (...a) => {
      await put(...a)
      if (a[0] === 10) setTimeout(() => { for (const k of ['inputItem', 'fuelItem', 'outputItem']) f[k] = () => { throw new Error('the block is gone') }; ac.abort() }, 30)
    }
    return f
  })(m.bot.openFurnace)
  const { rows } = await swordRows(() => run(m.bot, 2, ac.signal).then(r => r, e => e))
  assert.equal(m.burnt.wooden_sword, undefined)
  assert.deepEqual(rows, ['no_effect:wooden_sword outcome unknown (the furnace could not be read) for raw_iron active=1'])
  assert.deepEqual(m.dropped, [])
})

test('THE TAKE-BACK FAILS with the earlier sword still in the slot (both reviews r-rev4): no input goes in, nothing burns, nothing drops, no row', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1 }, 'easy')
  m.slots.fuel = { name: 'wooden_sword', type: 10, count: 1 }   // left by an earlier call
  let puts = 0
  m.bot.openFurnace = (orig => async () => {
    const f = await orig(); const take = f.takeFuel; const put = f.putInput
    let failed = false
    f.takeFuel = async (...a) => { if (!failed) { failed = true; throw new Error('the server did not answer the click') } return take(...a) }
    f.putInput = async (...a) => { puts += 1; return put(...a) }
    return f
  })(m.bot.openFurnace)
  const { out: r, rows } = await swordRows(() => run(m.bot, 2))
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'container_blocked')
  assert.equal(puts, 0, 'no input went in'); assert.equal(m.burnt.wooden_sword, undefined); assert.deepEqual(m.dropped, [])
  assert.equal(m.bag.raw_iron, 2); assert.equal(m.bag.coal, 1)
  assert.deepEqual(rows, [], 'no row claims the sword came back')
  foodSkipNow({ serverDifficulty: 'hard' })
})

test('THE TAKE-BACK STOPS BETWEEN ITS TWO CLICKS (Claude r-rev5): the sword on the cursor goes back into the bag, no input goes in, nothing drops', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1 }, 'easy')
  m.slots.fuel = { name: 'wooden_sword', type: 10, count: 1 }   // left by an earlier call
  let puts = 0, closedWithCursor = 0
  m.bot.openFurnace = (orig => async () => {
    const f = await orig(); const put = f.putInput; const close = f.close
    f.selectedItem = null
    f.takeFuel = async () => { f.selectedItem = { ...m.slots.fuel, slot: -1 }; m.slots.fuel = null; throw new Error('the second click timed out') }
    f.firstEmptySlotRange = () => 9; f.findItemRange = () => null; f.inventoryStart = 3; f.inventoryEnd = 39
    m.bot.clickWindow = async () => { if (f.selectedItem) { m.bag[f.selectedItem.name] = (m.bag[f.selectedItem.name] ?? 0) + 1; f.selectedItem = null } }
    f.putInput = async (...a) => { puts += 1; return put(...a) }
    f.close = () => { if (f.selectedItem) closedWithCursor += 1; return close() }
    return f
  })(m.bot.openFurnace)
  const { out: r } = await swordRows(() => run(m.bot, 2))
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'transfer_unsettled'); assert.match(r.detail, /back in your bag/)
  assert.equal(puts, 0, 'no input went in'); assert.equal(closedWithCursor, 0, 'the window never closed with the sword on the cursor')
  assert.equal(m.bag.wooden_sword, 1); assert.equal(m.burnt.wooden_sword, undefined); assert.deepEqual(m.dropped, [])
  foodSkipNow({ serverDifficulty: 'hard' })
})

test('A BURN SEEN ONLY AS AN EMPTIED SLOT (no heat reading yet, the item not yet cooked) when the job stops: one row, marked unconfirmed (Claude r-rev2)', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 1 }, 'peaceful', { fuelUnknown: true, litLagMs: 5000, noCook: true, tickMs: 20 })
  const ac = new AbortController()
  m.bot.openFurnace = (orig => async () => { const f = await orig(); const put = f.putFuel; f.putFuel = async (...a) => { await put(...a); if (a[0] === 10) setTimeout(() => ac.abort(), 1) }; return f })(m.bot.openFurnace)
  const { rows } = await swordRows(() => run(m.bot, 2, ac.signal).then(r => r, e => e))
  assert.equal(m.burnt.wooden_sword, 1, 'the sword did burn')
  assert.deepEqual(rows, ['success:burned wooden_sword (unconfirmed) for raw_iron active=1'])
  assert.deepEqual(m.dropped, [])
})

test('swordDrainRow: the row for each drain fate (pure)', () => {
  assert.deepEqual(swordDrainRow('taken', true), { outcome: 'no_effect', what: 'wooden_sword returned unburned' })
  assert.deepEqual(swordDrainRow(null, true, false), { outcome: 'success', what: 'burned wooden_sword (unconfirmed)' }, 'never taken, gone from the slot: it burned (Claude r-rev8)')
  assert.match(swordDrainRow(null, true, true).what, /^wooden_sword left in the furnace fuel slot \(the drain ran out of time\)/, 'never reached: still in the slot (Claude r-rev7)')
  assert.match(swordDrainRow(null, true, undefined).what, /^wooden_sword outcome unknown/)
  assert.match(swordDrainRow(null, true, true, 'stuck').what, /\(the drain stopped at a stuck cursor\)$/)
  assert.match(swordDrainRow('timed_out', true, false).what, /^wooden_sword outcome unknown \(its take never answered\)/, 'no credit (Codex r-rev11)')
  assert.match(swordDrainRow('timed_out', true, true).what, /^wooden_sword left in the furnace fuel slot \(the drain ran out of time\)/)
  assert.equal(swordDrainRow('timed_out', false, false), null)
  assert.match(swordDrainRow('kept_full', true).what, /left in the furnace fuel slot \(the bag is full\)/)
  assert.equal(swordDrainRow('kept_full', false), null, 'an earlier call\'s sword this call did not move: no row')
  assert.equal(swordDrainRow('taken', false), null)
  assert.match(swordDrainRow('kept_cursor', true).what, /^wooden_sword left in the furnace fuel slot \(the cursor/)
  assert.match(swordDrainRow('kept_cursor', false).what, /^wooden_sword put back into the furnace fuel slot from the cursor \(left by an earlier call\)/,
    'an earlier call\'s sword: a diagnostic row the read does not credit (Codex r-rev7)')
  for (const st of [true, false]) assert.deepEqual(swordDrainRow('cursor_lost', st), { outcome: 'failed', what: 'wooden_sword on the cursor at the close (the server drops it)' })
  for (const st of [true, false]) assert.deepEqual(swordDrainRow('cursor_server_returns', st), { outcome: 'no_effect', what: 'wooden_sword on the cursor at the close (the server returns it to the bag)' })
})

test('THE DRAIN RUNS OUT OF TIME on a hung output take with this call\'s sword still in the fuel slot: the row says it is in the furnace, not "returned" (Claude r-rev7)', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 1 }, 'peaceful', { holdIgnition: true })
  const ac = new AbortController()
  m.bot.openFurnace = (orig => async () => {
    const f = await orig()
    f.takeOutput = () => new Promise(() => {})          // never answers: the drain's whole deadline goes here
    f.putFuel = (put => async (...a) => { await put(...a); if (a[0] === 10) setTimeout(() => { m.slots.output = { name: 'iron_ingot', type: 2, count: 1 }; ac.abort() }, 50) })(f.putFuel)
    return f
  })(m.bot.openFurnace)
  const { rows } = await swordRows(() => run(m.bot, 2, ac.signal).then(r => r, e => e))
  assert.equal(m.slots.fuel?.name, 'wooden_sword'); assert.deepEqual(m.dropped, [])
  assert.deepEqual(rows, ['no_effect:wooden_sword left in the furnace fuel slot (the drain ran out of time) for raw_iron active=1'])
})

for (const [why, clickFails, expect] of [
  ['the bag takes it from the cursor', () => false, 'bag'],
  ['the bag will not take it: back into the fuel slot it came from', slot => slot >= 3, 'furnace'],
  ['nothing takes it and the bag filled meanwhile: the row says so (the server drops it at the close)', () => true, 'lost'],
]) {
  test(`THE DRAIN'S TAKE STOPS BETWEEN ITS TWO CLICKS (Codex, junkwell merge) -- ${why}`, async () => {
    const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 1 }, 'peaceful', { holdIgnition: true, liftFails: 1, clickFails, fillOnLift: expect === 'lost' })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 150)
    const { rows } = await swordRows(() => run(m.bot, 2, ac.signal).then(r => r, e => e))
    assert.equal(m.burnt.wooden_sword, undefined)
    if (expect === 'bag') {
      assert.equal(m.bag.wooden_sword, 1); assert.deepEqual(m.dropped, [])
      assert.deepEqual(rows, ['no_effect:wooden_sword returned unburned for raw_iron active=1'])
    } else if (expect === 'furnace') {
      assert.equal(m.slots.fuel?.name, 'wooden_sword'); assert.deepEqual(m.dropped, [], 'never closed on a loaded cursor')
      assert.deepEqual(rows, ['no_effect:wooden_sword left in the furnace fuel slot (the cursor could not be emptied into the bag) for raw_iron active=1'])
    } else {
      assert.deepEqual(m.dropped, ['wooden_sword'])
      assert.deepEqual(rows, ['failed:wooden_sword on the cursor at the close (the server drops it) for raw_iron active=1'])
    }
  })
}

test('THE TAKE-BACK OF AN EARLIER CALL\'S SWORD STOPS BETWEEN ITS CLICKS and the bag will not take it: the drain puts it back in the fuel slot -- no drop, a row', async () => {
  // the bag's slots never answer (every click into the bag throws): the take-back lifts it and stops; the drain's own
  // take lifts it again and stops; the fuel slot it came from takes it back both times.
  const m = makeBot({ raw_iron: 2, coal: 1 }, 'easy', { liftFails: 2, clickFails: slot => slot >= 3 })
  m.slots.fuel = { name: 'wooden_sword', type: 10, count: 1 }   // left by an earlier call
  let puts = 0
  m.bot.openFurnace = (orig => async () => { const f = await orig(); const put = f.putInput; f.putInput = async (...a) => { puts += 1; return put(...a) }; return f })(m.bot.openFurnace)
  const { out: r, rows } = await swordRows(() => run(m.bot, 2))
  assert.equal(r.status, 'failed'); assert.equal(r.failClass, 'transfer_unsettled')
  assert.equal(puts, 0); assert.deepEqual(m.dropped, []); assert.equal(m.slots.fuel?.name, 'wooden_sword'); assert.equal(m.burnt.wooden_sword, undefined)
  assert.deepEqual(rows, ['no_effect:wooden_sword put back into the furnace fuel slot from the cursor (left by an earlier call) for raw_iron active=0'],
    'an earlier call\'s sword: no second furnace credit (Codex r-rev7)')
  foodSkipNow({ serverDifficulty: 'hard' })
})

test('A STUCK CURSOR WITH ROOM IN THE BAG: the close returns it to the bag (vanilla, Paper probe) -- not a drop row (Claude r-rev9)', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 1 }, 'peaceful', { holdIgnition: true, liftFails: 1, clickFails: () => true })
  // the fake's close models vanilla: with room the cursor item goes back to the bag
  m.bot.openFurnace = (orig => async () => { const f = await orig(); const close = f.close; f.close = () => { if (f.selectedItem && f.emptySlotCount() > 0) { m.bag.wooden_sword = (m.bag.wooden_sword ?? 0) + 1; f.selectedItem = null } return close() }; return f })(m.bot.openFurnace)
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 150)
  const { rows } = await swordRows(() => run(m.bot, 2, ac.signal).then(r => r, e => e))
  assert.deepEqual(m.dropped, []); assert.equal(m.bag.wooden_sword, 1)
  assert.deepEqual(rows, ['no_effect:wooden_sword on the cursor at the close (the server returns it to the bag) for raw_iron active=1'])
})

test('RESTAGED (Codex r-rev9): a call that takes an earlier sword back and then leaves a sword in the furnace marks that row restaged=1; a later call does not', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 1 }, 'peaceful', { holdIgnition: true })
  m.slots.fuel = { name: 'wooden_sword', type: 10, count: 1 }   // left by an earlier call
  let full = false
  m.bot.openFurnace = (orig => async () => { const f = await orig(); const e = f.emptySlotCount; f.emptySlotCount = () => (full ? 0 : e()); return f })(m.bot.openFurnace)
  m.bot.clickWindow = async () => {}
  const ac = new AbortController()
  // the take-back runs with room; once a sword is staged the bag is full, so the staged sword stays in the furnace
  const put = m.bot.openFurnace
  m.bot.openFurnace = async () => { const f = await put(); const pf = f.putFuel; f.putFuel = async (...a) => { await pf(...a); if (a[0] === 10) { full = true; setTimeout(() => ac.abort(), 30) } }; return f }
  const { rows } = await swordRows(() => run(m.bot, 2, ac.signal).then(r => r, e => e))
  assert.deepEqual(rows, ['no_effect:wooden_sword returned unburned (left by an earlier call) for raw_iron active=1',
                          'no_effect:wooden_sword left in the furnace fuel slot (the bag is full) restaged=1 for raw_iron active=1'])
  assert.deepEqual(m.dropped, [])
  // a LATER call, nothing taken back: its sink row carries no mark
  full = false
  const ac2 = new AbortController()
  m.bot.openFurnace = async () => { const f = await put(); const pf = f.putFuel; f.putFuel = async (...a) => { await pf(...a); if (a[0] === 10) setTimeout(() => ac2.abort(), 30) }; return f }
  m.slots.fuel = null; m.bag.wooden_sword = 1; m.bag.raw_iron = 2
  const { rows: later } = await swordRows(() => run(m.bot, 2, ac2.signal).then(r => r, e => e))
  assert.ok(later.every(r => !/restaged=1/.test(r)), JSON.stringify(later))
})

test('A STUCK CURSOR ENDS THE DRAIN (Claude r-rev10): no later take clicks with a loaded cursor; the close judges the room then', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 1 }, 'peaceful', { holdIgnition: true, liftOutput: true, clickFails: () => true })
  const ac = new AbortController()
  m.bot.openFurnace = (orig => async () => {
    const f = await orig()
    f.putFuel = (put => async (...a) => { await put(...a); if (a[0] === 10) setTimeout(() => { m.slots.output = { name: 'iron_ingot', type: 2, count: 1 }; ac.abort() }, 50) })(f.putFuel)
    return f
  })(m.bot.openFurnace)
  const { rows } = await swordRows(() => run(m.bot, 2, ac.signal).then(r => r, e => e))
  assert.ok(m.slots.input, 'the input was not taken after the stuck cursor')
  assert.equal(m.slots.fuel?.name, 'wooden_sword', 'nor the sword')
  assert.equal(m.bag.iron_ingot, 1, 'the close returned the output on the cursor to the bag (room)'); assert.deepEqual(m.dropped, [])
  assert.deepEqual(rows, ['no_effect:wooden_sword left in the furnace fuel slot (the drain stopped at a stuck cursor) for raw_iron active=1'])
})

for (const [why, clickFails, expect] of [['the fuel slot takes it back', slot => slot >= 3, 'furnace'], ['nothing takes it, the bag full: a drop, and the row says so', () => true, 'lost']]) {
  test(`A FUEL TAKE THAT LIFTS THE SWORD, FILLS THE BAG AND NEVER ANSWERS (Codex r-rev11) -- ${why}`, async () => {
    const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 1 }, 'peaceful', { holdIgnition: true, liftHang: true, clickFails })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 150)
    const { rows } = await swordRows(() => run(m.bot, 2, ac.signal).then(r => r, e => e))
    assert.equal(m.burnt.wooden_sword, undefined)
    if (expect === 'furnace') {
      assert.equal(m.slots.fuel?.name, 'wooden_sword'); assert.deepEqual(m.dropped, [])
      assert.deepEqual(rows, ['no_effect:wooden_sword left in the furnace fuel slot (the cursor could not be emptied into the bag) for raw_iron active=1'])
    } else {
      assert.deepEqual(m.dropped, ['wooden_sword'])
      assert.deepEqual(rows, ['failed:wooden_sword on the cursor at the close (the server drops it) for raw_iron active=1'], 'never a credited burn')
    }
  })
}

test('A FUEL TAKE THAT NEVER ANSWERS AND MOVES NOTHING: the sword is not called taken -- the row says it is still in the furnace (Codex r-rev11)', async () => {
  const m = makeBot({ raw_iron: 2, coal: 1, wooden_sword: 1 }, 'peaceful', { holdIgnition: true, fuelHang: true })
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 150)
  const { rows } = await swordRows(() => run(m.bot, 2, ac.signal).then(r => r, e => e))
  assert.equal(m.slots.fuel?.name, 'wooden_sword'); assert.deepEqual(m.dropped, [])
  assert.deepEqual(rows, ['no_effect:wooden_sword left in the furnace fuel slot (the drain ran out of time) for raw_iron active=1'])
})
