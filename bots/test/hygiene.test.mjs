// INVENTORY HYGIENE, PHASE 1: never chase ballast; wear spent tools out by use. Nothing is ever dropped.
// The measurement and the owner's decision are in src/hygiene.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { wearOutPlan, wearTarget, neverPickUp, TRIGGER_SLOTS, SPENT_PICKAXES_KEPT, MAX_PER_ORDER } from '../src/hygiene.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

let slotN = 9
const it = (name, count = 1, extra = {}) => ({ name, count, slot: slotN++, ...extra })
const tool = (name, left, max = 131) => it(name, 1, { maxDurability: max, durabilityUsed: max - left })
const filled = (n, extra) => { slotN = 9; const a = [...extra]; while (a.length < n) a.push(it('cobblestone', a.length + 1)); return a }

await t(`below ${TRIGGER_SLOTS} slots nothing is worn out`, () => {
  const inv = filled(TRIGGER_SLOTS - 1, [tool('stone_axe', 1), tool('stone_pickaxe', 1)])
  assert.deepEqual(wearOutPlan(inv).tools, [])
})

await t(`spent = EXACTLY 1 use: axes/hoes go, pickaxes beyond ${SPENT_PICKAXES_KEPT} go, phantom 0-use copies are neither worn nor kept`, () => {
  slotN = 9
  const spent = [tool('stone_axe', 1), tool('stone_hoe', 1), tool('wooden_shovel', 0, 59),
                 tool('stone_pickaxe', 0), tool('stone_pickaxe', 0), tool('stone_pickaxe', 1), tool('stone_pickaxe', 1), tool('stone_pickaxe', 1), tool('wooden_pickaxe', 1, 59)]
  const keep = [tool('stone_pickaxe', 2), tool('iron_pickaxe', 200, 250), tool('stone_axe', 50), tool('stone_sword', 1)]
  const out = wearOutPlan(filled(36, [...spent, ...keep])).tools
  assert.ok(out.every(x => (x.maxDurability - x.durabilityUsed) === 1), 'only copies at exactly 1 use')
  assert.equal(out.filter(x => x.name.endsWith('_pickaxe')).length, 4 - SPENT_PICKAXES_KEPT, 'three REAL 1-use pickaxes kept; the 0-use phantoms do not count')
  for (const n of ['stone_axe', 'stone_hoe']) assert.ok(out.some(x => x.name === n), n)
  assert.ok(!out.some(x => x.name === 'wooden_shovel'), 'a 0-use copy is not real')
  assert.ok(!out.some(x => x.name === 'stone_sword'), 'swords are not worn out')
})

await t(`at most ${MAX_PER_ORDER} tools per order`, () => {
  slotN = 9
  const inv = filled(36, Array.from({ length: 8 }, () => tool('stone_axe', 1)))
  assert.equal(wearOutPlan(inv).tools.length, MAX_PER_ORDER)
})

await t('wearTarget is an ALLOWLIST of natural blocks: no ice, glass, built blocks, stations, plants', () => {
  const b = (name, hardness, boundingBox = 'block') => ({ name, hardness, boundingBox })
  for (const x of [b('dirt', 0.5), b('stone', 1.5), b('andesite', 1.5), b('oak_log', 2), b('grass_block', 0.6), b('netherrack', 0.4)]) assert.equal(wearTarget(x), true, x.name)
  for (const x of [b('air', 0, 'empty'), b('oak_sapling', 0, 'empty'), b('chest', 2.5), b('crafting_table', 2.5), b('ice', 0.5), b('glass', 0.3),
                   b('oak_planks', 2), b('cobblestone', 2), b('white_wool', 0.8), b('bookshelf', 1.5), b('infested_stone', 0.75),
                   b('furnace', 3.5), b('red_bed', 0.2), b('farmland', 0.6), b('obsidian', 50), b('deepslate', 3), b('leaf_litter', 0)])
    assert.equal(wearTarget(x), false, x.name)
})

await t('pickup: ballast on the floor is never chased; everything else is', () => {
  assert.equal(neverPickUp({ getDroppedItem: () => ({ name: 'leaf_litter' }) }), true)
  assert.equal(neverPickUp({ getDroppedItem: () => ({ name: 'cobblestone' }) }), false)
  assert.equal(neverPickUp({ getDroppedItem: () => ({ name: 'oak_sapling' }) }), false, 'saplings feed planting')
  assert.equal(neverPickUp({}), false)
})

// ---- the skill, through the real registry ---------------------------------------------------------------
process.env.LOG_DIR = '/tmp/mcbot-test-logs-hygiene'; process.env.BOT_NAME = 'TestBot'
const { SKILLS, SKILL_CONTRACTS } = await import('../src/skills.mjs')
const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), floored: () => V(x, y, z) })

function fakeBot ({ inv, toolBreaks = true, solidAround = true }) {
  const dug = []
  const bot = {
    heldItem: null, entity: { position: V(0, 64, 0) }, entities: {},
    inventory: { items: () => inv },
    blockAt: p => (solidAround && !(p.x === 0 && p.z === 0) ? { name: 'dirt', hardness: 0.5, boundingBox: 'block', position: p } : { name: 'air', hardness: 0, boundingBox: 'empty', position: p }),
    canDigBlock: () => true,
    equip: async x => { bot.heldItem = x },
    dig: async b => { dug.push(b.position); if (toolBreaks) inv.splice(inv.indexOf(bot.heldItem), 1); bot.heldItem = null },
    waitForTicks: async () => {}, pathfinder: { setGoal () {}, stop () {} },
  }
  return { bot, dug }
}

await t('wear_out is registered, has a loss contract, and is chatOnly -- the model can never choose it', () => {
  assert.ok(SKILLS.wear_out?.run); assert.equal(SKILLS.wear_out.chatOnly, true)
  assert.deepEqual(SKILL_CONTRACTS.wear_out.expects, ['inventory_loss'])
  assert.equal(SKILLS.discard, undefined, 'the tossing skill is gone')
})

await t('each planned tool is used for ONE dig on a side block at feet or head height, and is verified gone', async () => {
  const inv = filled(36, [tool('stone_axe', 1), tool('stone_hoe', 1), tool('stone_pickaxe', 90)])
  const { bot, dug } = fakeBot({ inv })
  const r = await SKILLS.wear_out.run({ bot }, {}, { aborted: false })
  assert.equal(r.status, 'success', r.detail)
  assert.equal(dug.length, 2)
  assert.ok(dug.every(p => !(p.x === 0 && p.z === 0)), 'never the bot\'s own column')
  assert.ok(dug.every(p => p.y >= 64), `never below the bot's feet: ${dug.map(p => p.y)}`)
  assert.ok(inv.some(x => x.name === 'stone_pickaxe'), 'the pickaxe with uses is untouched')
  assert.equal(inv.length, 34)
})

await t('a tool that SURVIVES the dig is reported, not claimed', async () => {
  const inv = filled(36, [tool('stone_axe', 1)])
  const { bot } = fakeBot({ inv, toolBreaks: false })
  const r = await SKILLS.wear_out.run({ bot }, {}, { aborted: false })
  assert.equal(r.status, 'failed'); assert.match(r.detail, /survived/)
})

const ground = (bot, { above = 'air', below = 'block' } = {}) => {
  bot.blockAt = p => p.y === 63 ? { name: 'dirt', hardness: 0.5, boundingBox: 'block', position: p }
    : p.y === 62 ? { name: below === 'block' ? 'stone' : 'cave_air', hardness: 1.5, boundingBox: below, position: p }
    : p.y === 64 && above !== 'air' && !(p.x === 0 && p.z === 0) ? { name: above, hardness: 0, boundingBox: 'empty', position: p }
    : { name: 'air', hardness: 0, boundingBox: 'empty', position: p }
}
await t('open ground: the ground beside the feet IS used, when it is safe', async () => {
  const inv = filled(36, [tool('stone_axe', 1)])
  const { bot, dug } = fakeBot({ inv }); ground(bot)
  bot.entity.position = { ...V(0.5, 64, 0.5), floored: () => V(0, 64, 0) }
  const r = await SKILLS.wear_out.run({ bot }, {}, { aborted: false })
  assert.equal(r.status, 'success', r.detail); assert.equal(dug.length, 1); assert.equal(dug[0].y, 63)
})
await t('but NEVER when the bot straddles onto that column (the ledge), a plant sits on it, or a cave is under it', async () => {
  for (const [label, setup] of [
    ['ledge', bot => { ground(bot); bot.entity.position = { ...V(0.75, 64, 0.5), floored: () => V(0, 64, 0) } }],
    ['sapling', bot => { ground(bot, { above: 'oak_sapling' }); bot.entity.position = { ...V(0.5, 64, 0.5), floored: () => V(0, 64, 0) } }],
    ['cave', bot => { ground(bot, { below: 'empty' }); bot.entity.position = { ...V(0.5, 64, 0.5), floored: () => V(0, 64, 0) } }],
  ]) {
    const inv = filled(36, [tool('stone_axe', 1)])
    const { bot, dug } = fakeBot({ inv }); setup(bot)
    await SKILLS.wear_out.run({ bot }, {}, { aborted: false })
    if (label === 'ledge') assert.ok(!dug.some(p => p.x === 1 && p.z === 0), `ledge: dug the column the bot stands on: ${JSON.stringify(dug)}`)
    else assert.equal(dug.length, 0, `${label}: dug ${JSON.stringify(dug)}`)
  }
})

await t('a same-name copy WITH USES in hand is never the one that digs', async () => {
  const inv = filled(36, [tool('stone_axe', 1)])
  const { bot, dug } = fakeBot({ inv })
  bot.equip = async () => { bot.heldItem = { ...tool('stone_axe', 90) } }   // the server put a healthy axe in hand
  const r = await SKILLS.wear_out.run({ bot }, {}, { aborted: false })
  assert.equal(dug.length, 0); assert.match(r.detail, /could not hold a spent/)
})

await t('a cell another bot stands in is never dug', async () => {
  const inv = filled(36, [tool('stone_axe', 1)])
  const { bot, dug } = fakeBot({ inv })
  // another entity occupies every side column at feet height
  bot.entities = Object.fromEntries([[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, z], i) => [i, { position: V(x + 0.5, 64, z + 0.5) }]))
  const r = await SKILLS.wear_out.run({ bot }, {}, { aborted: false })
  assert.equal(dug.length, 0, `dug ${JSON.stringify(dug)}`); assert.equal(r.status, 'failed')
})

await t('an equip that does not take digs NOTHING with the hand -- it stops and says so', async () => {
  const inv = filled(36, [tool('stone_axe', 1)])
  const { bot, dug } = fakeBot({ inv })
  bot.equip = async () => {}   // the server never put it in the hand
  const r = await SKILLS.wear_out.run({ bot }, {}, { aborted: false })
  assert.equal(r.status, 'failed'); assert.equal(dug.length, 0); assert.match(r.detail, /could not hold/)
})

await t('no safe block beside the bot: nothing is dug, the failure says why', async () => {
  const inv = filled(36, [tool('stone_axe', 1)])
  const { bot, dug } = fakeBot({ inv, solidAround: false })
  const r = await SKILLS.wear_out.run({ bot }, {}, { aborted: false })
  assert.equal(r.status, 'failed'); assert.equal(dug.length, 0); assert.match(r.detail, /no safe block/)
})

await t('WIRING (source, comments stripped): the order precedes planting, is cooldown-gated, and pickup filters ballast; nothing tosses', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const cog = strip(readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8'))
  const order = cog.indexOf("order = { skill: 'wear_out'"), plant = cog.indexOf('plantingOrder({')
  assert.ok(order > 0 && plant > order, 'the wear-out order precedes the planting order')
  assert.match(cog.slice(order - 500, order), /WEAR_OUT_COOLDOWN_MS/)
  const sk = strip(readFileSync(new URL('../src/skills.mjs', import.meta.url), 'utf8'))
  assert.match(sk, /e\.name === 'item' && !refused\.has\(e\.id\) && !neverPickUp\(e\)/)
  assert.ok(!/\.tossStack\(|bot\.toss\(/.test(sk), 'no skill tosses items')
  assert.match(cog, /admitted\.skill === 'wear_out'\) this\.wearOutBackoffUntil = r\.status === 'failed'/, 'a failed wear-out backs off')
  assert.match(cog, /admitted\?\.skill !== 'wear_out' && this\.milestones\.noteAttempt\(/, 'wear-out is not a milestone attempt')
  assert.match(cog, /if \(admitted\.skill !== 'wear_out'\) this\.lessons\.recordSuccess\(/, 'wear-out never becomes a reliable choice')
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
