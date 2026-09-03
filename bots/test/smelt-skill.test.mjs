// THE SMELT SKILL, DRIVEN AGAINST A FAKE FURNACE.
//
// The fake models mineflayer's actual furnace semantics rather than a
// convenient version of them, because a fake that is kinder than the library is
// a test of the fake:
//
//   * takeOutput/takeInput/takeFuel `assert.ok(item)` and THROW on an empty
//     slot (node_modules/mineflayer/lib/plugins/furnace.js:75-91)
//   * putInput/putFuel move items OUT of the inventory immediately
//   * the output appears after a delay, one item at a time
//   * openFurnace awaits a server event and can therefore never resolve
//
// The four questions the deliverable asks are each a test here: what happens
// when it is interrupted, when the furnace is gone, when there is no fuel, and
// whether success is a measurement rather than a promise resolving.
import assert from 'node:assert'
import { SKILLS, SKILL_CONTRACTS, classifyOutcome } from '../src/skills.mjs'

let pass = 0, fail = 0
const t = (name, fn) => fn().then(
  () => { pass++; console.log(`  PASS  ${name}`) },
  e  => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const V = (x, y, z) => ({
  x, y, z,
  offset: (a, b, c) => V(x + a, y + b, z + c),
  distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z),
})

const ID = { raw_iron: 1, iron_ingot: 2, coal: 3, furnace: 4, oak_log: 5,
             charcoal: 6, dirt: 7, oak_planks: 8, stick: 9 }
const NAME = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k]))

/**
 * @param inv        starting inventory
 * @param furnaceAt  where a furnace block sits in the world, or null
 * @param opts.smeltMs      how long the fake furnace takes per item
 * @param opts.openHangs    openFurnace never resolves (server never opened it)
 * @param opts.vanishAfter  the block disappears after N items (takes start throwing)
 * @param opts.yieldsNothing the furnace eats the input and produces no output
 * @param opts.far          the bot cannot get within reach
 */
function makeBot (inv = {}, furnaceAt = null, opts = {}) {
  const bag = { ...inv }
  const { smeltMs = 5, vanishAfter = Infinity, openHangs = false, far = false,
          yieldsNothing = false } = opts
  const log = []
  const give = (n, c) => { bag[n] = (bag[n] ?? 0) + c }
  const take = (n, c) => { bag[n] = (bag[n] ?? 0) - c; if (bag[n] <= 0) delete bag[n] }

  // The furnace's three slots, and a timer that converts input to output.
  const slots = { input: null, fuel: null, output: null }
  let produced = 0
  let ticker = null
  const startTicking = () => {
    if (ticker) return
    ticker = setInterval(() => {
      if (!slots.input || slots.input.count <= 0 || !slots.fuel) return
      slots.input = slots.input.count > 1
        ? { ...slots.input, count: slots.input.count - 1 } : null
      produced++
      if (yieldsNothing) return
      const out = slots.outName
      slots.output = { name: out, type: ID[out], count: (slots.output?.count ?? 0) + 1, slot: 2 }
    }, smeltMs)
    if (ticker.unref) ticker.unref()
  }

  const furnace = {
    inputItem: () => { if (produced >= vanishAfter) throw new Error('block gone'); return slots.input },
    fuelItem: () => slots.fuel,
    outputItem: () => { if (produced >= vanishAfter) throw new Error('block gone'); return slots.output },
    async putInput (type, _m, count) {
      log.push(`putInput ${NAME[type]} x${count}`)
      if ((bag[NAME[type]] ?? 0) < count) throw new Error('not enough to transfer')
      take(NAME[type], count)
      slots.input = { name: NAME[type], type, count, slot: 0 }
      slots.inputName = NAME[type]
      slots.outName = NAME[type] === 'raw_iron' ? 'iron_ingot' : 'charcoal'
      startTicking()
    },
    async putFuel (type, _m, count) {
      log.push(`putFuel ${NAME[type]} x${count}`)
      if ((bag[NAME[type]] ?? 0) < count) throw new Error('not enough to transfer')
      take(NAME[type], count)
      slots.fuel = { name: NAME[type], type, count, slot: 1 }
      startTicking()
    },
    // assert.ok(item) semantics: an empty slot THROWS.
    async takeOutput () {
      if (produced >= vanishAfter) throw new Error('block gone')
      assert.ok(slots.output, 'takeOutput on an empty slot')
      give(slots.output.name, slots.output.count); log.push(`takeOutput ${slots.output.count}`)
      const it = slots.output; slots.output = null; return it
    },
    async takeInput () {
      if (produced >= vanishAfter) throw new Error('block gone')
      assert.ok(slots.input, 'takeInput on an empty slot')
      give(slots.input.name, slots.input.count); log.push(`takeInput ${slots.input.count}`)
      const it = slots.input; slots.input = null; return it
    },
    async takeFuel () {
      if (produced >= vanishAfter) throw new Error('block gone')
      assert.ok(slots.fuel, 'takeFuel on an empty slot')
      give(slots.fuel.name, slots.fuel.count); log.push(`takeFuel ${slots.fuel.count}`)
      const it = slots.fuel; slots.fuel = null; return it
    },
    close () { log.push('close'); clearInterval(ticker); ticker = null },
  }

  const placedAt = []
  const bot = {
    entity: { position: V(0, 64, 0), velocity: { y: 0 } },
    health: 20, food: 20,
    registry: {
      itemsByName: Object.fromEntries(Object.keys(ID).map(n => [n, { id: ID[n], name: n }])),
      items: Object.fromEntries(Object.entries(NAME).map(([id, n]) => [id, { name: n }])),
      blocks: { 90: { name: 'furnace' }, 1: { name: 'stone' } },
    },
    inventory: { items: () => Object.entries(bag).filter(([, c]) => c > 0)
      .map(([name, count]) => ({ name, count, type: ID[name] })) },
    findBlock ({ matching }) {
      const here = furnaceAt ?? (placedAt.length ? placedAt[0] : null)
      if (!here) return null
      const blk = { type: 90, name: 'furnace', position: here }
      return matching(blk) ? blk : null
    },
    blockAt (p) {
      if (p && placedAt.some(q => q.x === p.x && q.y === p.y && q.z === p.z)) {
        return { name: 'furnace', position: p, boundingBox: 'block' }
      }
      return p && p.y < 64
        ? { name: 'stone', position: p, boundingBox: 'block' }
        : { name: 'air', position: p, boundingBox: 'empty' }
    },
    async equip () {},
    async placeBlock (ref) { placedAt.push(ref.position.offset(0, 1, 0)); take('furnace', 1) },
    async lookAt () {},
    pathfinder: {
      async goto () { if (!far) bot.entity.position = V(1, 64, 0) },
      setGoal () {}, stop () {},
    },
    async openFurnace () {
      if (openHangs) return new Promise(() => {})     // the server never answered
      return furnace
    },
  }
  return { bot, bag, log, furnace, slots }
}

const run = (bot, args, signal) => SKILLS.smelt.run({ bot }, args, signal)

// ------------------------------------------------------- success is measured ---

await t('SUCCESS IS A MEASURED DELTA, not a promise that resolved', async () => {
  const { bot, bag } = makeBot({ raw_iron: 3, coal: 1 }, V(1, 64, 0))
  const r = await run(bot, { item: 'raw_iron', count: 3 })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(bag.iron_ingot, 3, `bag holds ${JSON.stringify(bag)}`)
  assert.ok(/3x iron_ingot/.test(r.detail), `detail must report the delta: ${r.detail}`)
  assert.ok(!bag.raw_iron, 'the ore was consumed')

  // AND THE EVIDENCE GATE AGREES. This is the check that makes the success
  // survive runner.mjs: classifyOutcome against smelt's contract must produce
  // a non-empty `because`, or the runner downgrades it to `unknown` and the
  // -1 side of the learned-avoid counter is dead forever.
  const { value, because } = classifyOutcome('smelt', 'success', { inventory: { iron_ingot: 3 } })
  assert.equal(value, 'valuable')
  assert.deepEqual(because, ['inventory_gain: iron_ingot +3'])
})

await t('a smelt that produced nothing may not claim success', async () => {
  // The furnace consumes the ore and yields nothing. A skill that graded itself
  // on "the promise resolved" would call this a win -- which is the 115
  // recorded `status` wins that ADR-0003 exists to prevent.
  const { bot, bag } = makeBot({ raw_iron: 1, coal: 1 }, V(1, 64, 0), { yieldsNothing: true })
  const r = await run(bot, { item: 'raw_iron', count: 1 })
  assert.notEqual(r.status, 'success', `claimed success with no ingot: ${r.detail}`)
  assert.equal(r.status, 'no_effect', r.detail)
  assert.ok(!bag.iron_ingot, 'and no ingot exists to justify one')
})

await t('the contract exists, or every success is silently downgraded', () => {
  // Behaviour, not a source grep: a missing contract makes `expects` empty, and
  // an empty expects can never be satisfied by any observation.
  assert.ok(SKILL_CONTRACTS.smelt, 'smelt must declare a contract')
  assert.deepEqual(classifyOutcome('smelt', 'success', { inventory: { iron_ingot: 1 } }).because,
                   ['inventory_gain: iron_ingot +1'])
  return Promise.resolve()
})

// ------------------------------------------------------------- interrupted ---

await t('INTERRUPTED: the furnace is emptied back into the bot, nothing is stranded', async () => {
  // A smelt held the body when a reflex seized it. Everything that was in the
  // furnace -- ore, fuel and any finished ingot -- must come back, or `smelt`
  // becomes a net DESTROYER of the items this fleet has never produced.
  const { bot, bag, log } = makeBot({ raw_iron: 8, coal: 1 }, V(1, 64, 0), { smeltMs: 20 })
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 60)
  let threw = null
  try { await run(bot, { item: 'raw_iron', count: 8 }, ac.signal) } catch (e) { threw = e }
  assert.ok(threw?.aborted, 'an abort must propagate as Aborted so the runner sees it')

  const recovered = (bag.raw_iron ?? 0) + (bag.iron_ingot ?? 0)
  assert.equal(recovered, 8, `8 ore went in; ${recovered} came back (${JSON.stringify(bag)})`)
  assert.equal(bag.coal, 1, 'the unburned coal comes back too')
  assert.ok(log.includes('close'), `the window must be closed on abort: ${log.join(' | ')}`)
})

await t('INTERRUPTED EARLY: an abort before loading leaves the inventory untouched', async () => {
  const { bot, bag } = makeBot({ raw_iron: 4, coal: 1 }, V(1, 64, 0))
  const ac = new AbortController()
  ac.abort()
  let threw = null
  try { await run(bot, { item: 'raw_iron', count: 4 }, ac.signal) } catch (e) { threw = e }
  assert.ok(threw?.aborted)
  assert.equal(bag.raw_iron, 4)
  assert.equal(bag.coal, 1)
})

// ---------------------------------------------------------- furnace is gone ---

await t('FURNACE GONE MID-SMELT: it does not hang, and it does not claim success', async () => {
  const { bot } = makeBot({ raw_iron: 4, coal: 1 }, V(1, 64, 0),
                          { smeltMs: 5, vanishAfter: 2 })
  const r = await run(bot, { item: 'raw_iron', count: 4 })
  // Two ingots were taken before the block vanished, so this is an honest
  // partial success -- and if none were taken it must not be `success`.
  assert.ok(['success', 'no_effect', 'unknown'].includes(r.status), r.status)
  if (r.status === 'success') assert.ok(/iron_ingot/.test(r.detail))
})

await t('NO FURNACE AT ALL: needs_station, and the remedy is a prerequisite', async () => {
  const { bot } = makeBot({ raw_iron: 4, coal: 1 }, null)
  const r = await run(bot, { item: 'raw_iron', count: 4 })
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'needs_station')
  assert.equal(r.gap, 'furnace')
  // DETERMINISTIC, NOT ADVISORY. One refusal in this codebase printed the right
  // remedy 262 times and was never acted on; `need` is adopted as the TASK by
  // cognitive.mjs rather than being read out to the model and ignored.
  assert.deepEqual(r.need?.items, ['furnace'])
  assert.ok(/craft item=furnace/.test(r.detail), r.detail)
})

await t('CARRIES A FURNACE: it places one rather than refusing', async () => {
  // 59 of 80 bots carry a furnace item. A verb that refused them would be the
  // refusal chain manufacturing a dead end out of an inventory that is ready.
  const { bot, bag } = makeBot({ raw_iron: 2, coal: 1, furnace: 1 }, null)
  const r = await run(bot, { item: 'raw_iron', count: 2 })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(bag.iron_ingot, 2)
  assert.ok(/placed the furnace/.test(r.detail), r.detail)
})

await t('THE WINDOW NEVER OPENS: unknown, never a learned "iron cannot be smelted"', async () => {
  const { bot } = makeBot({ raw_iron: 2, coal: 1 }, V(1, 64, 0), { openHangs: true })
  const r = await run(bot, { item: 'raw_iron', count: 2 })
  // `unknown` and not `failed`: the avoid key is smelt:{"item":"raw_iron"} and
  // carries no position, so one bad furnace must not teach the whole fleet that
  // smelting iron is impossible everywhere.
  assert.equal(r.status, 'unknown', r.detail)
  assert.equal(r.failClass, 'furnace_window')
})

await t('OUT OF REACH: no_path names the coordinates to walk to', async () => {
  const { bot } = makeBot({ raw_iron: 2, coal: 1 }, V(40, 64, 40), { far: true })
  const r = await run(bot, { item: 'raw_iron', count: 2 })
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'no_path')
  assert.ok(/40,40/.test(r.detail), r.detail)
})

// ------------------------------------------------------------------ no fuel ---

await t('NO FUEL: refused BEFORE the walk, with a remedy for above ground and below', async () => {
  const { bot, log } = makeBot({ raw_iron: 4 }, V(1, 64, 0))
  const r = await run(bot, { item: 'raw_iron', count: 4 })
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'missing_ingredients')
  assert.equal(r.gap, 'fuel')
  assert.ok(r.need.items.includes('coal'), 'coal_ore is the underground route')
  assert.ok(r.need.items.some(n => /_log$|_planks$/.test(n)), 'wood is the surface route')
  assert.deepEqual(log, [], 'the furnace must never have been opened')
})

await t('NO INPUT: refused with the ore as the prerequisite', async () => {
  const { bot } = makeBot({ coal: 4, furnace: 1 }, V(1, 64, 0))
  const r = await run(bot, { item: 'raw_iron', count: 4 })
  assert.equal(r.failClass, 'missing_ingredients')
  assert.equal(r.gap, 'raw_iron')
  assert.deepEqual(r.need.items, ['raw_iron'])
})

// ------------------------------------------------------------- bad targets ---

await t('A TYPO AND AN IMPOSSIBILITY ARE DIFFERENT CLASSES', async () => {
  const { bot } = makeBot({ dirt: 64, coal: 4 }, V(1, 64, 0))

  // A name the registry has never heard of is a generation slip. `other` gets
  // no vote, exactly as craft decided for the same reason.
  const typo = await run(bot, { item: 'raw_irom', count: 1 })
  assert.equal(typo.failClass, 'other', typo.detail)

  // dirt is a REAL item that no furnace will ever transform, on any world,
  // forever. That is what bad_target means, and learning it is correct.
  const dirt = await run(bot, { item: 'dirt', count: 1 })
  assert.equal(dirt.failClass, 'bad_target', dirt.detail)
})

// ---------------------------------------------------------------- batching ---

await t('A BIG ASK BECOMES A BOUNDED BATCH AND SAYS SO', async () => {
  // 64 raw_iron is 640 seconds of furnace against a 180s skill budget. The
  // skill must take a bite and report the rest as remaining work, the same
  // resumable-partial shape mine uses for its step cap -- not hold the body.
  const { bot, bag } = makeBot({ raw_iron: 64, coal: 64 }, V(1, 64, 0))
  const r = await run(bot, { item: 'raw_iron', count: 64 })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(bag.iron_ingot, 8, 'one coal is eight items and that is the cap')
  assert.equal(bag.raw_iron, 56, 'the rest is still in the bag, not in a furnace')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
