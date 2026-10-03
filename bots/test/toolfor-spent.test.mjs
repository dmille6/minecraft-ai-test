// SPENT TOOLS GET USED UP (owner, 10-03: full bags are the root blocker; never toss or drop). Behaviour only, through
// the exported pure functions and the real harvest dig, against REAL 1.21 block data (prismarine-block digTime and
// canHarvest), because the decision turns on real dig times: a wooden axe takes a log in 1.5 s against the hand's 3.0 s,
// inside toolFor's SLACK, so the hand used to win even when the axe was not floor-reserved.
//
// Fleet 10-03 ~22:45Z, bots at >= 34/36 slots: ~118-170 dig-tool copies at 2-10 uses, overwhelmingly SOLE axes (74)
// and shovels (53), held forever -- toolFor reserved any copy at <= FLOOR uses for blocks that need its tier, and no
// block needs an axe or a shovel to drop.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { toolFor, travelTool, usableTools, spentPickaxeFor, hardStopFor, byCost, remaining, FLOOR, HARD_STOP } from '../src/toolfor.mjs'
import { diffTools, spentTools } from '../src/toolwatch.mjs'
import { wearRefusals, survivorVerdict } from '../src/hygiene.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

const require_ = createRequire(import.meta.url)
const VERSION = '1.21.11'
const mcData = require_('minecraft-data')(VERSION)
const Block = require_('prismarine-block')(VERSION)
const blk = (name, pos = null) => { const b = Block.fromStateId(mcData.blocksByName[name].defaultState, 0); if (pos) b.position = pos; return b }
let slotN = 9
const item = (name, left) => {
  const max = mcData.itemsByName[name].maxDurability
  return { name, type: mcData.itemsByName[name].id, count: 1, maxDurability: max, durabilityUsed: max - left, slot: slotN++ }
}
const LOG = blk('oak_log'), DIRT = blk('dirt'), STONE = blk('stone'), COAL = blk('coal_ore'), IRON_ORE = blk('iron_ore'), DIAMOND = blk('diamond_ore')

await t('INSTRUMENT: the real dig times this file depends on (a wooden axe is inside SLACK of the hand on a log)', () => {
  assert.equal(LOG.digTime(null, false, false, false), 3000)
  assert.equal(LOG.digTime(mcData.itemsByName.wooden_axe.id, false, false, false), 1500)
  assert.equal(LOG.digTime(mcData.itemsByName.stone_axe.id, false, false, false), 750)
  assert.equal(DIRT.digTime(mcData.itemsByName.wooden_shovel.id, false, false, false), 400)
  assert.equal(DIRT.digTime(null, false, false, false), 750)
})

// ---- PART 1: axes, shovels, hoes are used up ----------------------------------------------------------------------
await t('a SOLE spent axe IS swung on a log, and a sole spent shovel on dirt -- every tier', () => {
  for (const name of ['wooden_axe', 'stone_axe', 'iron_axe']) {
    for (const left of [10, 5, 2, 1]) {
      const r = toolFor(LOG, [item(name, left)])
      assert.equal(r.item?.name, name, `${name} at ${left}: ${r.reason}`)
    }
  }
  for (const name of ['wooden_shovel', 'stone_shovel', 'iron_shovel']) {
    const r = toolFor(DIRT, [item(name, 3)])
    assert.equal(r.item?.name, name, `${name} at 3: ${r.reason}`)
  }
  assert.equal(toolFor(LOG, [item('wooden_axe', 5)]).reason, 'use_up', 'the wooden axe wins where the hand used to (inside SLACK)')
})

await t('control: a NON-spent wooden axe still yields to the hand on a log (the hand-within-SLACK rule is unchanged above FLOOR)', () => {
  assert.deepEqual(toolFor(LOG, [item('wooden_axe', FLOOR + 1)]), { item: null, hand: true, reason: 'hand' })
  assert.equal(toolFor(LOG, [item('stone_axe', 100)]).item.name, 'stone_axe', 'a stone axe is outside SLACK of the hand: it was always used')
})

await t('a spent tool is used up only where it is FASTER than the hand: an axe never wastes a swing on dirt, a shovel never on a log', () => {
  assert.equal(toolFor(DIRT, [item('stone_axe', 3)]).hand, true)
  assert.equal(toolFor(LOG, [item('stone_shovel', 3)]).hand, true)
})

await t('among copies of the SAME NAME the most-worn goes first (finish one before starting the next)', () => {
  const worn = item('stone_axe', 3), fresh = item('stone_axe', 120)
  assert.equal(toolFor(LOG, [fresh, worn]).item, worn)
  assert.equal(toolFor(LOG, [worn, fresh]).item, worn)
  const s1 = item('iron_shovel', 2), s2 = item('iron_shovel', 200)
  assert.equal(toolFor(DIRT, [s2, s1]).item, s1)
  const h1 = item('stone_axe', 40), h2 = item('stone_axe', 90)
  assert.equal(toolFor(LOG, [h2, h1]).item, h1, 'above FLOOR too: same-name copies are finished in order')
})

await t('ACROSS tiers the cheapest adequate tier still goes first: a fuller cheaper tool is not displaced, iron is never preferred for being fuller', () => {
  // wooden axe (50) + spent stone axe (3): the stone axe makes the hand lose; the wooden axe is the cheapest within the cap
  assert.equal(toolFor(LOG, [item('stone_axe', 3), item('wooden_axe', 50)]).item.name, 'wooden_axe')
  assert.equal(toolFor(LOG, [item('iron_axe', 250), item('stone_axe', 90)]).item.name, 'stone_axe')
  assert.equal(toolFor(LOG, [item('iron_axe', 3), item('stone_axe', 90)]).item.name, 'stone_axe', 'a spent iron does not jump the tier order')
  assert.equal(toolFor(DIRT, [item('iron_shovel', 250), item('stone_shovel', 2)]).item.name, 'stone_shovel')
  // the comparator itself: tier first; reversed wear ONLY within one consumable name
  const x = (name, r, tier) => ({ name, r, tier, spend: !/_pickaxe$/.test(name) })
  assert.ok(byCost(x('stone_axe', 3, 2), x('stone_axe', 90, 2)) < 0)
  assert.ok(byCost(x('stone_pickaxe', 3, 2), x('stone_pickaxe', 90, 2)) > 0, 'pickaxes: the fuller copy first, unchanged')
  assert.ok(byCost(x('stone_axe', 3, 2), x('stone_shovel', 90, 2)) > 0, 'different kinds of one tier: the fuller first, unchanged')
  assert.ok(byCost(x('iron_axe', 3, 3), x('stone_axe', 90, 2)) > 0)
  assert.equal(byCost(x('stone_axe', Infinity, 2), x('stone_axe', Infinity, 2)), 0, 'two unknown durabilities tie, never NaN')
})

await t('a 0-use axe/shovel/hoe is NEVER chosen (the server already broke it); a 1-use one IS', () => {
  assert.equal(hardStopFor(item('stone_axe', 5)), 0)
  assert.equal(hardStopFor(item('wooden_hoe', 5)), 0)
  assert.equal(hardStopFor(item('stone_shovel', 5)), 0)
  assert.deepEqual(toolFor(LOG, [item('stone_axe', 0)]), { item: null, hand: true, reason: 'hand' })
  assert.equal(toolFor(LOG, [item('stone_axe', 1)]).item.name, 'stone_axe')
  assert.equal(toolFor(LOG, [item('stone_axe', 0), item('stone_axe', 1)]).item.durabilityUsed, mcData.itemsByName.stone_axe.maxDurability - 1)
  assert.equal(toolFor(DIRT, [item('wooden_shovel', 1)]).item.name, 'wooden_shovel')
})

// ---- pickaxes: unchanged --------------------------------------------------------------------------------------------
await t('PICKAXES UNCHANGED: FLOOR reserve, HARD_STOP=1, iron retention, the fuller copy first, never "used up" on dirt', () => {
  assert.equal(HARD_STOP, 1)
  assert.equal(hardStopFor(item('stone_pickaxe', 5)), HARD_STOP)
  assert.equal(toolFor(STONE, [item('stone_pickaxe', 5)]).reason, 'reserved_required', 'a lone spent pickaxe is still only swung when nothing else can')
  assert.equal(toolFor(STONE, [item('stone_pickaxe', 1)]).reason, 'none', 'a 1-use pickaxe is still hard-stopped (no lastSwing)')
  assert.equal(toolFor(STONE, [item('stone_pickaxe', 20), item('stone_pickaxe', 90)]).item.durabilityUsed, mcData.itemsByName.stone_pickaxe.maxDurability - 90)
  assert.equal(toolFor(IRON_ORE, [item('iron_pickaxe', FLOOR), item('stone_pickaxe', 100)]).item.name, 'stone_pickaxe', 'iron retention')
  assert.equal(toolFor(DIAMOND, [item('iron_pickaxe', FLOOR), item('stone_pickaxe', 100)]).reason, 'reserved_required')
  assert.equal(toolFor(DIRT, [item('stone_pickaxe', 5)]).hand, true, 'a spent pickaxe is never "used up" on dirt')
  assert.deepEqual(usableTools(STONE, [item('stone_pickaxe', 1)]), [], 'the exit contract still honours HARD_STOP')
  assert.equal(usableTools(LOG, [item('stone_axe', 1)]).length, 0, 'usableTools is untouched (HARD_STOP for every kind)')
})

await t('travel digs follow the same decision: a sole spent shovel digs the dirt in the pathfinder\'s way', () => {
  assert.equal(travelTool(DIRT, [item('stone_shovel', 4)], null)?.name, 'stone_shovel')
  assert.notEqual(travelTool(STONE, [item('stone_pickaxe', 1)], null)?.name, 'stone_pickaxe', 'never a 1-use pickaxe')
})

// ---- PART 2: a spent pickaxe is spent while a working one is held ----------------------------------------------------
await t('PART 2: on stone, a harvest dig swings the 1-use pickaxe when ANOTHER pickaxe with > FLOOR uses is held', () => {
  const spent = item('stone_pickaxe', 1), working = item('stone_pickaxe', 90)
  const r = toolFor(STONE, [working, spent], { lastSwing: true })
  assert.equal(r.item, spent); assert.equal(r.reason, 'spend_spent')
  assert.equal(toolFor(STONE, [working, spent]).item, working, 'not on a travel or reflex dig (no lastSwing)')
  assert.equal(toolFor(blk('deepslate'), [item('iron_pickaxe', 200), item('wooden_pickaxe', 1)], { lastSwing: true }).item.name, 'wooden_pickaxe')
  assert.equal(spentPickaxeFor(STONE, [working, spent]), spent)
})

await t('PART 2 never fires otherwise: no working pickaxe above FLOOR, off the stone family, or only a 0-use phantom', () => {
  const spent = item('stone_pickaxe', 1)
  for (const left of [FLOOR, 5, 2]) {
    const other = item('stone_pickaxe', left)
    const r = toolFor(STONE, [other, spent], { lastSwing: true })
    assert.equal(r.item, other, `with a ${left}-use other pickaxe the 1-use copy must not be chosen (${r.reason})`)
    assert.equal(spentPickaxeFor(STONE, [other, spent]), null)
  }
  const working = item('stone_pickaxe', 90)
  assert.equal(toolFor(COAL, [working, spent], { lastSwing: true }).item, working, 'coal ore buys no pickaxe')
  assert.equal(toolFor(IRON_ORE, [working, item('stone_pickaxe', 1)], { lastSwing: true }).item, working)
  assert.equal(toolFor(STONE, [working, item('stone_pickaxe', 0)], { lastSwing: true }).item, working, 'a 0-use copy is a phantom')
  assert.equal(toolFor(STONE, [spent, item('stone_pickaxe', 1)], { lastSwing: true }).reason, 'last_swing', 'all spent: the old last swing, unchanged')
  assert.equal(spentPickaxeFor(STONE, [item('stone_axe', 90), spent]), null, 'a working AXE is not a working pickaxe')
})

// ---- liveness rows ------------------------------------------------------------------------------------------------
await t('LIVENESS: tool_spent names a copy that reached 1 use BY USE; tool_broke names an axe/shovel/hoe that broke in use', () => {
  const at = left => [item('stone_axe', left)]
  assert.deepEqual(spentTools(at(2), at(1)), [{ name: 'stone_axe', spent: 1, from: 2 }])
  assert.deepEqual(spentTools(at(1), at(1)), [], 'already spent: not again')
  assert.deepEqual(spentTools([], at(1)), [], 'picked up or crafted spent: not by use')
  assert.deepEqual(spentTools([item('stone_axe', 1), item('stone_axe', 5)], [item('stone_axe', 1), item('stone_axe', 1)]), [{ name: 'stone_axe', spent: 1, from: 5 }])
  for (const name of ['stone_axe', 'iron_shovel', 'wooden_hoe']) {
    const d = diffTools([item(name, 1)], [])
    assert.equal(d.length, 1); assert.equal(d[0].broke, true, `${name} breaking at 1 use is tool_broke`)
  }
})

// ---- THE CHAIN: a sole tool worn from 5 uses to broken, five dig calls through the real harvest dig -----------------
process.env.LOG_DIR = '/tmp/mcbot-test-logs-toolfor-spent'; process.env.BOT_NAME = 'TestBot'
const { collectManually } = await import('../src/skills.mjs')
const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z), floored: () => V(Math.floor(x), Math.floor(y), Math.floor(z)) })
// A server that wears the held tool one use per broken block and removes it at 0 -- AFTER deciding the drop, as vanilla
// does. Six cells of `name` in a row beside the bot; each dig turns its cell to air.
function chainBot (name, tools) {
  const inv = [...tools]
  const world = new Map()
  for (let x = 1; x <= 6; x++) world.set(`${x},64,0`, name)
  const bot = {
    heldItem: null, swings: [], drops: [],
    entity: { position: V(0.5, 64, 0.5), onGround: true, velocity: V(0, 0, 0) },
    entities: {},
    inventory: { items: () => inv, emptySlotCount: () => 5 },
    canDigBlock: () => true,
    blockAt: p => { const n = world.get(`${p.x},${p.y},${p.z}`); return n ? blk(n, V(p.x, p.y, p.z)) : { name: 'air', boundingBox: 'empty', position: p } },
    equip: async it => { bot.heldItem = inv.includes(it) ? it : null },
    dig: async b => {
      const h = bot.heldItem
      bot.swings.push(h ? `${h.name}@${remaining(h)}` : 'hand')
      bot.drops.push(b.canHarvest(h?.type ?? null) ? b.name : 'nothing')   // the drop is decided BEFORE the damage
      world.delete(`${b.position.x},${b.position.y},${b.position.z}`)
      if (h) { h.durabilityUsed++; if (remaining(h) <= 0) { inv.splice(inv.indexOf(h), 1); bot.heldItem = null } }
    },
    nearestEntity: () => null, pathfinder: { goto: async () => {}, setGoal () {}, stop () {} },
  }
  return { bot, inv }
}
const snap = inv => inv.map(it => ({ ...it }))
async function chain (name, tool, digs) {
  const { bot, inv } = chainBot(name, [tool])
  const rows = { spent: [], broke: [] }
  for (let x = 1; x <= digs; x++) {
    const before = snap(inv)
    try { await collectManually(bot, bot.blockAt(V(x, 64, 0)), new AbortController().signal, { deadline: Date.now() + 2000 }) } catch (e) { bot.swings.push(`threw:${e.failClass ?? e.message}`) }
    for (const d of spentTools(before, inv)) rows.spent.push(`${d.name}<-${d.from}`)
    for (const d of diffTools(before, inv)) if (d.broke) rows.broke.push(`${d.name}@${d.least}`)
  }
  return { bot, inv, rows }
}

{
  // dirt and oak_planks (not logs: no pickup transaction in the way of the wear being counted)
  const sh = await chain('dirt', item('stone_shovel', 5), 6)
  await t('CHAIN: a sole stone_shovel at 5 uses digs five dirt through collectManually, breaks IN USE on the fifth, the sixth is by hand', () => {
    assert.deepEqual(sh.bot.swings, ['stone_shovel@5', 'stone_shovel@4', 'stone_shovel@3', 'stone_shovel@2', 'stone_shovel@1', 'hand'])
    assert.deepEqual(sh.bot.drops, ['dirt', 'dirt', 'dirt', 'dirt', 'dirt', 'dirt'], 'every dig dropped its block, the breaking one included')
    assert.equal(sh.inv.length, 0, 'the slot is free')
    assert.deepEqual(sh.rows.spent, ['stone_shovel<-2'], 'one tool_spent, when it reached 1 use')
    assert.deepEqual(sh.rows.broke, ['stone_shovel@1'], 'one tool_broke, at its last use')
  })
  const ax = await chain('oak_planks', item('wooden_axe', 5), 6)
  await t('CHAIN: a sole wooden_axe at 5 uses (inside SLACK of the hand) is worn to broken across five digs', () => {
    assert.deepEqual(ax.bot.swings, ['wooden_axe@5', 'wooden_axe@4', 'wooden_axe@3', 'wooden_axe@2', 'wooden_axe@1', 'hand'])
    assert.equal(ax.inv.length, 0)
    assert.deepEqual(ax.rows.spent, ['wooden_axe<-2'])
    assert.deepEqual(ax.rows.broke, ['wooden_axe@1'])
  })
  const pk = await chain('stone', item('stone_pickaxe', 5), 3)
  await t('CHAIN control: a sole stone_pickaxe at 5 digs stone (the block needs it) and is still held after three digs', () => {
    assert.deepEqual(pk.bot.swings, ['stone_pickaxe@5', 'stone_pickaxe@4', 'stone_pickaxe@3'])
    assert.equal(pk.inv.length, 1, 'still held')
  })
}

// ---- PART 3: diagnosis strings (logging only) ---------------------------------------------------------------------
await t('PART 3: wear_out\'s refusal tally names each guard, most first; the late look says which survivor it was', () => {
  assert.equal(wearRefusals({ not_natural: 9, room_liquid: 2, occupied: 1, footprint: 0 }, 12), '12 cells: not_natural 9, room_liquid 2, occupied 1')
  assert.equal(wearRefusals({}, 0), '0 cells: none refused')
  assert.equal(survivorVerdict({ slotKnown: true, item: null, name: 'stone_axe' }), 'late_break')
  assert.equal(survivorVerdict({ slotKnown: true, item: item('stone_axe', 1), name: 'stone_axe' }), 'confirmed_survivor')
  assert.equal(survivorVerdict({ slotKnown: true, item: item('dirt', 1), name: 'stone_axe' }), 'slot_changed')
  assert.equal(survivorVerdict({ slotKnown: false, item: null, name: 'stone_axe' }), 'unknown')
})

// ---- MUTANTS: each must turn a test above red. Anchor asserted present and unique; the mutant is a temp copy. --------
const TOOLFOR = new URL('../src/toolfor.mjs', import.meta.url)
async function withMutant (old, neu, fn) {
  const src = readFileSync(TOOLFOR, 'utf8')
  assert.ok(src.includes(old), `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} -- a mutant never written reads as killed`)
  assert.equal(src.split(old).length, 2, 'the mutation anchor is not unique')
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, src.replace(old, neu))
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}
const killed = async (label, old, neu, probe) => t(`MUTANT KILLED: ${label}`, () => withMutant(old, neu, async m => {
  let survived = true
  try { probe(m) } catch { survived = false }
  assert.equal(survived, false, 'the mutant passed the probe: the test above cannot see this defect')
}))
await killed('the FLOOR reserve restored for axes/shovels/hoes',
  'const open = timed.filter(x => x.spend || x.r > FLOOR).sort(byCost)', 'const open = timed.filter(x => x.r > FLOOR).sort(byCost)',
  m => { assert.equal(m.toolFor(LOG, [item('stone_axe', 5)]).item?.name, 'stone_axe') })
await killed('the wear comparator reversed for every kind',
  'const d = a.name === b.name && a.spend ? a.r - b.r : b.r - a.r', 'const d = a.r - b.r',
  m => { assert.equal(m.toolFor(STONE, [item('stone_pickaxe', 20), item('stone_pickaxe', 90)]).item.durabilityUsed, mcData.itemsByName.stone_pickaxe.maxDurability - 90) })
await killed('part 2 without the working-pickaxe (> FLOOR) check',
  '  if (!picks.some(it => remaining(it) > FLOOR)) return null\n', '',
  m => { const other = item('stone_pickaxe', 5); assert.equal(m.toolFor(STONE, [other, item('stone_pickaxe', 1)], { lastSwing: true }).item, other) })
await killed('hard stop 0 applied to pickaxes too',
  'export const hardStopFor = it => (isConsumable(it?.name) ? 0 : HARD_STOP)', 'export const hardStopFor = it => 0',
  m => { assert.equal(m.toolFor(STONE, [item('stone_pickaxe', 1)]).reason, 'none') })

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
