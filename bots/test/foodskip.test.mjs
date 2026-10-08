// FOOD IS NOT CHASED IN A PEACEFUL WORLD (foodskip.mjs, owner 10-05): the switch, the decision, and the real sweep.
//
// Behaviour, not text: the mode parser and the decision are pure exports; the sweep is the REAL pickupNearbyItems
// against a fake bot that records which drops it walked to. The non-default modes run in a child process, because
// FOOD_SKIP is read once when skills.mjs loads (like PLANT_ENABLED).
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { foodSkipMode, foodSkipActive, isFoodName, skipFoodDrop, foodSkipDetail, FOOD_SKIP_MODES } from '../src/foodskip.mjs'
import { pickupNearbyItems, foodSkipNow } from '../src/skills.mjs'
import { tapRecords } from '../src/logger.mjs'
import { DEPOSIT_VALUE, DEPOSIT_ALWAYS } from '../src/bankable.mjs'

const require_ = createRequire(import.meta.url)
const mcData = require_('minecraft-data')('1.21.8')
const FOODS = mcData.foodsByName

test('the switch: absent/empty is auto; auto|on|off in any case; anything else is auto AND says it was unreadable', () => {
  assert.deepEqual(FOOD_SKIP_MODES, ['auto', 'on', 'off'])
  assert.equal(foodSkipMode({}).mode, 'auto')
  assert.equal(foodSkipMode({ FOOD_SKIP: '' }).mode, 'auto')
  assert.equal(foodSkipMode({ FOOD_SKIP: '  ' }).mode, 'auto')
  assert.equal(foodSkipMode({ FOOD_SKIP: 'ON' }).mode, 'on')
  assert.equal(foodSkipMode({ FOOD_SKIP: ' off ' }).mode, 'off')
  assert.equal(foodSkipMode({ FOOD_SKIP: 'Auto' }).mode, 'auto')
  const bad = foodSkipMode({ FOOD_SKIP: 'yes' })
  assert.equal(bad.mode, 'auto', 'an unreadable value must never become a silent on')
  assert.equal(bad.valid, false)
  assert.match(foodSkipDetail({ ...bad, difficulty: 'peaceful', active: true }), /unreadable, using auto/)
})

test('the decision: auto skips ONLY on peaceful; unknown difficulty picks food up; on/off override the world', () => {
  assert.equal(foodSkipActive('auto', 'peaceful'), true)
  for (const d of ['easy', 'normal', 'hard', undefined, null, '']) assert.equal(foodSkipActive('auto', d), false, `auto + ${d}`)
  for (const d of ['peaceful', 'easy', 'normal', 'hard', undefined]) {
    assert.equal(foodSkipActive('on', d), true, `on + ${d}`)
    assert.equal(foodSkipActive('off', d), false, `off + ${d}`)
  }
})

test('food is minecraft-data\'s edible set: apples, bread, meat, berries -- and nothing the ladder or the bank uses', () => {
  for (const n of ['apple', 'golden_apple', 'bread', 'cooked_beef', 'beef', 'sweet_berries', 'melon_slice', 'carrot', 'potato', 'cooked_mutton', 'dried_kelp'])
    assert.equal(isFoodName(n, FOODS), true, n)
  for (const n of ['stick', 'oak_log', 'oak_planks', 'cobblestone', 'coal', 'raw_iron', 'iron_ingot', 'stone_pickaxe', 'crafting_table',
                   'oak_sapling', 'bone_meal', 'wheat', 'leaf_litter', 'bamboo', 'chest', 'torch', 'bucket'])
    assert.equal(isFoodName(n, FOODS), false, n)
  // Every banked material and every always-banked ore stays chaseable: the skip cannot starve the ladder or the bank.
  for (const n of [...DEPOSIT_VALUE, ...DEPOSIT_ALWAYS, 'birch_log', 'jungle_log', 'diamond']) assert.equal(isFoodName(n, FOODS), false, `${n} is not food`)
  assert.equal(isFoodName('apple', null), false, 'no foods table: nothing is food (never a guess)')
  assert.equal(isFoodName(undefined, FOODS), false)
})

test('skipFoodDrop: only food, only while active; an unreadable entity is chased as before', () => {
  const drop = name => ({ getDroppedItem: () => ({ name }) })
  const on = { active: true, foodsByName: FOODS }, off = { active: false, foodsByName: FOODS }
  assert.equal(skipFoodDrop(drop('apple'), on), true)
  assert.equal(skipFoodDrop(drop('apple'), off), false)
  assert.equal(skipFoodDrop(drop('cobblestone'), on), false)
  assert.equal(skipFoodDrop({ getDroppedItem: () => { throw new Error('no metadata') } }, on), false)
  assert.equal(skipFoodDrop({}, on), false)
})

// ---- the real sweep -------------------------------------------------------------------------------------------
const V = (x, y, z) => ({ x, y, z, distanceTo (o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z) } })
function botWith (drops, difficulty) {
  const visited = []
  const alive = new Map(drops.map(d => [d.id, d]))
  const bot = {
    game: { difficulty },
    registry: mcData,
    entity: { position: V(0, 0, 0) },
    nearestEntity (pred) {
      const c = [...alive.values()].filter(pred)
      c.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))
      return c[0] ?? null
    },
    pathfinder: {
      async goto (goal) {
        const d = [...alive.values()].find(q => q.position.x === goal.x && q.position.y === goal.y && q.position.z === goal.z)
        visited.push(d?.what)
        bot.entity.position = V(goal.x, goal.y, goal.z)
        alive.delete(d?.id)
      },
    },
  }
  return { bot, visited, alive }
}
const drop = (id, what, x) => ({ id, what, name: 'item', position: V(x, 0, 0), getDroppedItem: () => ({ name: what }) })
const scene = () => [drop(1, 'apple', 1), drop(2, 'oak_log', 2), drop(3, 'bread', 3), drop(4, 'stick', 4)]

test('PEACEFUL (auto): the sweep walks past the apple and the bread to the log and the stick', async () => {
  const { bot, visited, alive } = botWith(scene(), 'peaceful')
  await pickupNearbyItems(bot, null)
  assert.deepEqual(visited, ['oak_log', 'stick'])
  assert.ok(alive.has(1) && alive.has(3), 'the food stays on the floor (the server may still hand it over at ~1 block)')
})

test('NOT peaceful (auto): food is chased exactly as before, nearest first', async () => {
  for (const d of ['easy', 'normal', 'hard', undefined]) {
    const { bot, visited } = botWith(scene(), d)
    await pickupNearbyItems(bot, null)
    assert.deepEqual(visited, ['apple', 'oak_log', 'bread', 'stick'], `difficulty ${d}`)
  }
})

test('auto follows the world: a change between sweeps changes the next sweep, with EXACTLY one row per change', async () => {
  const rows = []
  const untap = tapRecords(r => { if (r?.skill?.name === '_food_skip') rows.push(r) })
  const step = (bot, difficulty, active, added, why) => {
    const n = rows.length
    bot.game.difficulty = difficulty
    assert.equal(foodSkipNow(bot).active, active, why)
    assert.equal(rows.length - n, added, `${why}: ${added} row(s)`)
  }
  try {
    const { bot } = botWith([], 'hard')
    step(bot, 'hard', false, 1, 'a new (decision, difficulty) writes its row')
    step(bot, 'hard', false, 0, 'the same again writes nothing')
    step(bot, 'peaceful', true, 1, 'peaceful turns it on')
    step(bot, 'peaceful', true, 0, 'unchanged')
    step(bot, 'easy', false, 1, 'off again')
    step(bot, 'normal', false, 1, 'a difficulty change alone is recorded too')
    step(bot, undefined, false, 1, 'no packet yet: unknown, food is picked up')
  } finally { untap() }
  const text = rows.map(r => r.skill.detail).join('\n')
  assert.match(text, /food skip ON: mode=auto difficulty=peaceful active=1/)
  assert.match(text, /food skip off: mode=auto difficulty=easy active=0/)
  assert.match(text, /food skip off: mode=auto difficulty=unknown active=0/)
})

// THE SWITCH, END TO END: FOOD_SKIP is read when skills.mjs loads, so each mode runs the real sweep in its own process.
function sweepIn (mode, difficulty) {
  const src = `
    import { pickupNearbyItems } from ${JSON.stringify(new URL('../src/skills.mjs', import.meta.url).href)}
    import { createRequire } from 'node:module'
    const mc = createRequire(import.meta.url)('minecraft-data')('1.21.8')
    const V = (x, y, z) => ({ x, y, z, distanceTo (o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z) } })
    const alive = new Map([[1, 'apple', 1], [2, 'oak_log', 2]].map(([id, what, x]) => [id, { id, what, name: 'item', position: V(x, 0, 0), getDroppedItem: () => ({ name: what }) }]))
    const visited = []
    const bot = { game: { difficulty: ${JSON.stringify(difficulty)} }, registry: mc, entity: { position: V(0, 0, 0) },
      nearestEntity (p) { const c = [...alive.values()].filter(p); c.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)); return c[0] ?? null },
      pathfinder: { async goto (g) { const d = [...alive.values()].find(q => q.position.x === g.x); visited.push(d.what); bot.entity.position = V(g.x, g.y, g.z); alive.delete(d.id) } } }
    await pickupNearbyItems(bot, null)
    console.log('VISITED ' + visited.join(','))
  `
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', src],
    { env: { ...process.env, FOOD_SKIP: mode }, cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' })
  return /VISITED (.*)/.exec(out)?.[1]
}

test('FOOD_SKIP=off: food is chased even on peaceful (the owner\'s off switch)', () => {
  assert.equal(sweepIn('off', 'peaceful'), 'apple,oak_log')
})
test('FOOD_SKIP=on: food is skipped even on a hard world', () => {
  assert.equal(sweepIn('on', 'hard'), 'oak_log')
})
test('FOOD_SKIP=bogus: behaves as auto (skips on peaceful, chases on normal)', () => {
  assert.equal(sweepIn('bogus', 'peaceful'), 'oak_log')
  assert.equal(sweepIn('bogus', 'normal'), 'apple,oak_log')
})

// ---- THE DIFFICULTY, AS THE SERVER ACTUALLY SENDS IT (found on the Paper sandbox 10-05) -------------------------------
// Every candidate row on Paper 1.21.8 said `difficulty=unknown active=0` in a peaceful world: the tests above set
// bot.game.difficulty by hand, which mineflayer itself never manages to do on 1.21.8. These run the REAL protocol codec
// and the REAL mineflayer game plugin.
const { normalizeDifficulty, attachDifficulty, difficultyOf } = await import('../src/foodskip.mjs')
const { EventEmitter } = await import('node:events')
const mcp = require_('minecraft-protocol')

test('THE CAUSE: 1.21.8 decodes the difficulty to a NAME, and mineflayer 4.37.1 then reads undefined', () => {
  const ser = mcp.createSerializer({ state: 'play', isServer: true, version: '1.21.8' })
  const des = mcp.createDeserializer({ state: 'play', isServer: false, version: '1.21.8' })
  const wire = des.parsePacketBuffer(ser.createPacketBuffer({ name: 'difficulty', params: { difficulty: 0, difficultyLocked: false } })).data.params
  assert.equal(wire.difficulty, 'peaceful', 'the codec maps varint 0 to the name')
  const bot = new EventEmitter(); bot._client = new EventEmitter(); bot._client.registerChannel = () => {}
  bot.registry = mcData; bot.supportFeature = f => f === 'customChannelIdentifier'
  require_('mineflayer/lib/plugins/game.js')(bot, { version: '1.21.8', brand: 'vanilla' })
  attachDifficulty(bot)
  bot._client.emit('difficulty', wire)
  assert.equal(bot.game.difficulty, undefined, 'mineflayer indexes its name table with a name: undefined (if this starts passing, mineflayer fixed it)')
  assert.equal(bot.serverDifficulty, 'peaceful', 'our own reading of the same packet')
  assert.equal(difficultyOf(bot), 'peaceful')
  assert.equal(foodSkipActive('auto', difficultyOf(bot)), true, 'so auto is ON in a peaceful world')
  bot._client.emit('difficulty', { difficulty: 'hard', difficultyLocked: false })
  assert.equal(foodSkipActive('auto', difficultyOf(bot)), false, 'and OFF again when the world turns hard')
})

test('normalizeDifficulty: names (any case) and the older 0..3; anything else is unknown', () => {
  assert.equal(normalizeDifficulty('peaceful'), 'peaceful'); assert.equal(normalizeDifficulty('HARD'), 'hard')
  assert.equal(normalizeDifficulty(0), 'peaceful'); assert.equal(normalizeDifficulty(2), 'normal')
  for (const v of [undefined, null, 4, -1, 1.5, 'weird', {}]) assert.equal(normalizeDifficulty(v), null, String(v))
  assert.equal(difficultyOf({ game: { difficulty: 'easy' } }), 'easy', 'mineflayer\'s value is still used if it is ever right')
  assert.equal(difficultyOf({ serverDifficulty: 'peaceful', game: { difficulty: undefined } }), 'peaceful')
  assert.equal(difficultyOf({}), null)
})

test('WIRED: index.mjs attaches the difficulty reader right after createBot', () => {
  const src = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(src, /\n\s*attachDifficulty\(bot\)\n/)
  assert.match(src, /import \{ attachDifficulty \} from '\.\/foodskip\.mjs'/)
})

test('APPLES: a compost visit that only lost apples is the composter\'s effect only while the policy is on (runner evidence)', async () => {
  const { classifyOutcome } = await import('../src/skills.mjs')
  const { setPeacefulFood } = await import('../src/foodskip.mjs')
  try {
    setPeacefulFood(false)
    assert.deepEqual(classifyOutcome('compost', 'success', { inventory: { apple: -6 } }).because, [], 'off: an apple loss is not compost evidence (today\'s rule)')
    setPeacefulFood(true)
    assert.match(classifyOutcome('compost', 'success', { inventory: { apple: -6 } }).because.join(';'), /inventory_loss: apple -6/)
    assert.deepEqual(classifyOutcome('compost', 'success', { inventory: { bread: -6 } }).because, [], 'other food never')
  } finally { setPeacefulFood(false) }
})

test('WITH THE TOWN DEPOSIT UNDERNEATH: apples are never banked (composted above 4, or kept) -- the two orders cannot fight over them', async () => {
  let TD = null
  try { TD = await import('../src/towndeposit.mjs') } catch { return }   // only on a line that carries towndeposit
  const it = (name, count, slot) => ({ name, count, slot, type: mcData.itemsByName[name].id })
  const bag = [it('apple', 30, 9), it('cobblestone', 64, 10), it('cobblestone', 64, 11), it('cobblestone', 20, 12), it('raw_copper', 5, 13),
               ...Array.from({ length: 30 }, (_, i) => it('white_wool', 1, 14 + i))]
  const plan = TD.townDepositPlan(bag)
  assert.ok(plan.steps.length >= 1, 'positive control: the deposit banks something here')
  assert.ok(!plan.steps.some(s => s.name === 'apple'), 'apples are not a banking target')
})
