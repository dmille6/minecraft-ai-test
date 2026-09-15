import assert from 'node:assert/strict'
import { toolFor, remaining, usableTools, applyToolPolicy, travelTool, handFiller, FLOOR, HARD_STOP } from '../src/toolfor.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
// item type ids as minecraft-data would hand them out; harvestTools is keyed by these
const ID = { wooden_pickaxe: 1, stone_pickaxe: 2, iron_pickaxe: 3, diamond_pickaxe: 4, wooden_shovel: 5 }
const item = (name, left, max = 250) => ({ name, type: ID[name], count: 1, maxDurability: max, durabilityUsed: max - left })
const SPEED = { 1: 2, 2: 4, 3: 6, 4: 8, 5: 2 }   // tool speed by type id (minecraft: wooden 2, stone 4, iron 6, diamond 8)
// a block: hardness, and the set of tool ids that harvest it (undefined = hand-harvestable)
const NAME = Object.fromEntries(Object.entries(ID).map(([n, i]) => [i, n]))
// a block: hardness, the set of tool ids that harvest it (undefined = hand-harvestable), and its tool class; only a
// tool of the block's class gets its speed (a pickaxe on dirt digs at hand speed, as in the game)
const block = (name, hardness, ids, cls = 'pickaxe') => ({
  name, harvestTools: ids ? Object.fromEntries(ids.map(i => [i, true])) : undefined,
  digTime: (typeId) => typeId && SPEED[typeId] && NAME[typeId].endsWith('_' + cls) ? Math.round(1500 * hardness / SPEED[typeId]) : Math.round(1500 * hardness * (ids ? 5 : 1.5))
})
const STONE = block('stone', 1.5, [1, 2, 3, 4]), IRON_ORE = block('iron_ore', 3, [2, 3, 4]), DIAMOND_ORE = block('diamond_ore', 3, [3, 4]), DIRT = block('dirt', 0.5, undefined, 'shovel'), DEEPSLATE = block('deepslate', 3, [1, 2, 3, 4])

t('the cheapest eligible tool within the speed cap wins, never the fastest: stone over iron on stone and on iron ore; wooden (3x slower than iron) yields', () => {
  const inv = [item('iron_pickaxe', 240), item('stone_pickaxe', 100, 131), item('wooden_pickaxe', 50, 59)]
  assert.equal(toolFor(STONE, inv).item.name, 'stone_pickaxe')
  assert.equal(toolFor(STONE, [item('wooden_pickaxe', 50, 59), item('stone_pickaxe', 100, 131)]).item.name, 'wooden_pickaxe', 'wooden is within 2x of stone')
  assert.equal(toolFor(IRON_ORE, inv).item.name, 'stone_pickaxe')
  assert.equal(toolFor(DIAMOND_ORE, inv).item.name, 'iron_pickaxe')
})
t('a cheaper tool outside the speed cap yields to the next tier; a slow tool is still preferred over spending a floor-reserved iron', () => {
  assert.equal(toolFor(DEEPSLATE, [item('iron_pickaxe', 240), item('wooden_pickaxe', 50, 59)]).item.name, 'iron_pickaxe')
  const r = toolFor(DEEPSLATE, [item('wooden_pickaxe', 50, 59)]); assert.equal(r.item.name, 'wooden_pickaxe'); assert.equal(r.reason, 'cheapest')
  const s = toolFor(DEEPSLATE, [item('iron_pickaxe', FLOOR), item('wooden_pickaxe', 50, 59)]); assert.equal(s.item.name, 'wooden_pickaxe'); assert.equal(s.reason, 'slow')
})
t('hand-harvestable blocks: the hand digs dirt when it is within the cap of the shovel; a tool is named when the hand is far slower', () => {
  const r = toolFor(DIRT, [item('wooden_shovel', 40, 59), item('iron_pickaxe', 240)])
  // the hand digs dirt at 5x the tool-less penalty here: outside the cap -> the cheapest eligible tool, the shovel, never the iron
  assert.equal(r.item.name, 'wooden_shovel')
  const soft = { name: 'snow', harvestTools: undefined, digTime: (id) => id ? 100 : 150 }
  assert.deepEqual(toolFor(soft, [item('wooden_shovel', 40, 59)]), { item: null, hand: true, reason: 'hand' }, 'the hand within the cap beats any tool')
  assert.deepEqual(toolFor(DIRT, []), { item: null, hand: true, reason: 'hand' })
  assert.equal(toolFor(STONE, []).reason, 'none', 'stone needs a pickaxe: no hand, no tool')
})
t(`the durability floor: a tool with ${FLOOR} or fewer uses is reserved for blocks that need its tier; ${FLOOR + 1} is open`, () => {
  const lowIron = item('iron_pickaxe', FLOOR), stone = item('stone_pickaxe', 100, 131)
  assert.equal(toolFor(STONE, [lowIron, stone]).item.name, 'stone_pickaxe')
  assert.equal(toolFor(IRON_ORE, [lowIron, stone]).item.name, 'stone_pickaxe')
  const r = toolFor(DIAMOND_ORE, [lowIron, stone]); assert.equal(r.item.name, 'iron_pickaxe'); assert.equal(r.reason, 'reserved_required')
  assert.equal(toolFor(STONE, [item('iron_pickaxe', FLOOR + 1)]).reason, 'cheapest', 'eleven uses is not reserved')
  assert.equal(toolFor(STONE, [lowIron]).reason, 'reserved_required', 'reserved iron still digs stone when it is the only pickaxe (the remedy the bot can perform)')
})
t(`the hard stop: ${HARD_STOP} or 0 uses left is never a candidate, even alone, even for the block that needs it`, () => {
  assert.equal(toolFor(DIAMOND_ORE, [item('iron_pickaxe', HARD_STOP)]).reason, 'none')
  assert.equal(toolFor(DIAMOND_ORE, [item('iron_pickaxe', 0)]).reason, 'none')
  assert.equal(toolFor(STONE, [item('iron_pickaxe', 0), item('stone_pickaxe', 2, 131)]).item.name, 'stone_pickaxe')
  assert.deepEqual(usableTools(DIAMOND_ORE, [item('iron_pickaxe', 1), item('iron_pickaxe', 2)]).map(i => remaining(i)), [2])
})
t('unknown durability counts as full (Infinity), a missing inventory is an empty one, and the fuller of two equal tools is chosen', () => {
  assert.equal(remaining({ name: 'iron_pickaxe' }), Infinity)
  assert.equal(toolFor(STONE, null).reason, 'none')
  const a = item('stone_pickaxe', 20, 131), b = item('stone_pickaxe', 90, 131)
  assert.equal(toolFor(STONE, [a, b]).item, b)
})
t('a block that answers canHarvest (prismarine-block) is judged by it, harvestTools or not: a tool it names is used, the hand is not', () => {
  const stoneByPredicate = { name: 'stone', canHarvest: type => type === ID.wooden_pickaxe, digTime: () => 500 }
  assert.equal(toolFor(stoneByPredicate, [item('wooden_pickaxe', 50, 59)]).item.name, 'wooden_pickaxe')
  assert.equal(toolFor(stoneByPredicate, []).reason, 'none')
  const dirtByPredicate = { name: 'dirt', canHarvest: () => true, digTime: () => 500 }
  assert.equal(toolFor(dirtByPredicate, [item('iron_pickaxe', 240)]).hand, true, 'equal dig time: the hand is cheapest')
})
t('applied: when the answer is the hand or nothing, a held tool is taken out of the hand; a chosen tool is returned; a bare hand is left alone', () => {
  const calls = []
  const bot = (held, inv, empty = 5) => ({ heldItem: held, inventory: { items: () => inv, emptySlotCount: () => empty }, unequip: dest => { calls.push('unequip:' + dest); return Promise.resolve() }, equip: (it, dest) => { calls.push('equip:' + it.name + ':' + dest); return Promise.resolve() } })
  const spent = item('iron_pickaxe', HARD_STOP); const cobble = { name: 'cobblestone', count: 12 }
  assert.equal(applyToolPolicy(bot(spent, [spent, cobble]), DIAMOND_ORE), null); assert.deepEqual(calls, ['equip:cobblestone:hand'], 'the hard-stopped pickaxe leaves the hand for a block, never tossed')
  calls.length = 0
  assert.equal(applyToolPolicy(bot(spent, [spent]), DIAMOND_ORE), null); assert.deepEqual(calls, ['unequip:hand'], 'no filler: unequip, which is safe with a free slot')
  calls.length = 0
  assert.equal(applyToolPolicy(bot(spent, [spent], 0), DIAMOND_ORE), null); assert.deepEqual(calls, [], 'no filler and no free slot: unequip would TOSS the tool (mineflayer tossStack), so the hand is left alone')
  calls.length = 0
  assert.equal(applyToolPolicy(bot(item('iron_pickaxe', 240), [item('iron_pickaxe', 240), cobble]), DIRT), null); assert.deepEqual(calls, ['equip:cobblestone:hand'], 'dirt by hand: the iron comes out of the hand')
  calls.length = 0
  assert.equal(applyToolPolicy(bot(null, [item('stone_pickaxe', 100, 131)]), STONE).name, 'stone_pickaxe'); assert.deepEqual(calls, [])
  assert.equal(applyToolPolicy(bot({ name: 'cobblestone', count: 3 }, []), DIRT), null); assert.deepEqual(calls, [], 'a block in hand is not a tool; nothing to unequip')
})
t('travel digs: the decision\'s tool, else the cheapest open tool when a tool would otherwise stay in the hand, else null', () => {
  const inv = [item('iron_pickaxe', 240), item('wooden_shovel', 40, 59)]
  assert.equal(travelTool(DIRT, inv, item('iron_pickaxe', 240)).name, 'wooden_shovel')
  assert.equal(travelTool(DIRT, [item('iron_pickaxe', 240)], item('iron_pickaxe', 240)).name, 'iron_pickaxe', 'the only open tool is the iron: it stays (a travel dig cannot unequip)')
  assert.equal(travelTool(DIRT, inv, null).name, 'wooden_shovel', 'the shovel is within the cap and cheapest: it digs the dirt')
  assert.equal(travelTool(DIRT, [item('iron_pickaxe', 240)], null), null, 'nothing held and only an iron pickaxe carried: the hand digs dirt')
  const spent = item('iron_pickaxe', HARD_STOP), cobble = { name: 'cobblestone', count: 12 }
  assert.equal(travelTool(STONE, [spent, cobble], spent), cobble, 'only a spent pickaxe carried and held: the pathfinder is handed a block, so the spent tool never digs')
  assert.equal(travelTool(STONE, [spent], spent), null, 'nothing else at all: null (the pathfinder digs with what is held; nothing can be done)')
  assert.equal(handFiller([spent, { name: 'iron_sword', count: 1 }, { name: 'stick', count: 3 }]).name, 'stick')
  assert.equal(travelTool(STONE, inv, null).name, 'iron_pickaxe', 'stone needs a pickaxe: the only one carried')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
