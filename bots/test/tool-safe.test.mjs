// NEVER THROW A TOOL AWAY; SPEND THE CHEAPEST BLOCK; HOLD A BLOCK, NOT A PICKAXE, WHEN THE HAND WILL DO.
// mineflayer's unequip('hand') TOSSES the held stack on a full bag (proved on the sandbox 2026-09-30: at 36/36 a stone
// pickaxe landed on the ground; with one free slot it was kept). ~45 good stone pickaxes/day were lost this way.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { emptyHand, freeSlots, pickScaffold, scaffoldRank, travelTool, tossAverted } from '../src/toolfor.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const pick = (name, left = 100, max = 131) => ({ name, count: 1, type: 1, maxDurability: max, durabilityUsed: max - left })
const stack = (name, count) => ({ name, count, type: 2 })
function bot ({ held, items, free, hotbar = null }) {
  const calls = []
  const b = { calls, heldItem: held, inventory: { items: () => items, emptySlotCount: () => free, slots: hotbar },
              unequip: async w => { calls.push(['unequip', w]); b.heldItem = null },
              equip: async (it, w) => { calls.push(['equip', it.name, w]); b.heldItem = it } }
  if (hotbar) b.setQuickBarSlot = i => { calls.push(['quickbar', i]); b.heldItem = hotbar[36 + i] }
  return b
}

await t('a free slot AND a filler: the filler is swapped in -- unequip can toss even with a free slot (a pickup can fill it mid-click)', async () => {
  const b = bot({ held: pick('stone_pickaxe'), items: [pick('stone_pickaxe'), stack('dirt', 64)], free: 1 })
  assert.equal(await emptyHand(b), 'filler'); assert.deepEqual(b.calls, [['equip', 'dirt', 'hand']])
})
await t('a free slot and NO filler: the plain unequip (the last resort)', async () => {
  const b = bot({ held: pick('stone_pickaxe'), items: [pick('stone_pickaxe'), pick('wooden_axe', 30, 59)], free: 1 })
  assert.equal(await emptyHand(b), 'unequip'); assert.deepEqual(b.calls, [['unequip', 'hand']])
})
await t('a bag of ONLY tools with an axe on the hotbar: select the axe (no click) -- never swing the last pickaxe', async () => {
  const hot = []; hot[36] = pick('stone_pickaxe'); hot[37] = pick('wooden_axe', 30, 59)
  const b = bot({ held: hot[36], items: [hot[36], hot[37]], free: 0, hotbar: hot })
  assert.equal(await emptyHand(b), 'hotbar_other'); assert.deepEqual(b.calls, [['quickbar', 1]]); assert.equal(b.heldItem.name, 'wooden_axe')
})
await t('a swap that does not take is reported as FAILED, not as success', async () => {
  const b = bot({ held: pick('stone_pickaxe'), items: [pick('stone_pickaxe'), stack('dirt', 64)], free: 0 })
  b.equip = async () => {}   // the server rejected it: the pickaxe is still in hand
  assert.equal(await emptyHand(b), 'failed')
})
await t('UNKNOWN inventory is not free space', async () => {
  assert.equal(freeSlots({ inventory: {} }), 0); assert.equal(freeSlots({ inventory: { items: () => [stack('dirt', 1)] } }), 35)
})
await t('A FULL BAG holding a pickaxe: a block is swapped INTO the hand -- unequip (which tosses) is never called', async () => {
  const b = bot({ held: pick('stone_pickaxe'), items: [pick('stone_pickaxe'), stack('dirt', 64)], free: 0 })
  assert.equal(await emptyHand(b), 'filler'); assert.deepEqual(b.calls, [['equip', 'dirt', 'hand']])
})
await t('a full bag holding a LOG stack: kept (it digs like the hand) -- the old unequip threw the stack away', async () => {
  const b = bot({ held: stack('oak_log', 40), items: [stack('oak_log', 40), pick('stone_pickaxe')], free: 0 })
  assert.equal(await emptyHand(b), 'kept'); assert.deepEqual(b.calls, [])
})
await t('a full bag of ONLY tools: the tool stays in hand -- one use spent beats a whole tool thrown away', async () => {
  const b = bot({ held: pick('stone_pickaxe'), items: [pick('stone_pickaxe'), pick('wooden_axe', 30, 59)], free: 0 })
  assert.equal(await emptyHand(b), 'kept_tool'); assert.deepEqual(b.calls, [])
})
await t('a bot with NO emptySlotCount (a fake, or an old API) counts its stacks -- 1 of 36 is not a full bag', async () => {
  const b = { calls: [], heldItem: pick('wooden_pickaxe'), inventory: { items: () => [pick('wooden_pickaxe')] }, unequip: async () => { b.calls.push('unequip'); b.heldItem = null }, equip: async () => { b.calls.push('equip') } }
  assert.equal(await emptyHand(b), 'unequip'); assert.deepEqual(b.calls, ['unequip'])
})
await t('THE ROW COUNTS ONLY TOOL TOSSES AVERTED -- a second call holding the swapped-in dirt is not one', async () => {
  assert.equal(tossAverted('stone_pickaxe', 'filler', true), true); assert.equal(tossAverted('iron_axe', 'kept_tool', true), true)
  assert.equal(tossAverted('stone_pickaxe', 'hotbar_other', true), true)
  assert.equal(tossAverted('dirt', 'kept', true), false, 'the filler a previous call swapped in')
  assert.equal(tossAverted('stone_pickaxe', 'filler', false), false, 'a free slot: the old unequip would not have tossed')
})
await t('nothing held: nothing to do', async () => {
  const b = bot({ held: null, items: [], free: 0 }); assert.equal(await emptyHand(b), 'empty'); assert.deepEqual(b.calls, [])
})

const PLACEABLE = /^(dirt|cobblestone|stone|sand|gravel|andesite|diorite|granite|deepslate|cobbled_deepslate|sandstone|red_sandstone|dripstone_block|tuff|netherrack|coarse_dirt|rooted_dirt)$|(_log|_planks|_wood|_hyphae)$|^(crimson_stem|warped_stem|stripped_crimson_stem|stripped_warped_stem)$/
await t('SCAFFOLD cheapest first: cobblestone before the logs listed ahead of it (the old pick was inventory order)', async () => {
  const items = [stack('oak_log', 40), stack('oak_planks', 8), stack('cobblestone', 20)]
  assert.equal(items.find(it => PLACEABLE.test(it.name)).name, 'oak_log', 'positive control: the old order spends the logs')
  assert.equal(pickScaffold(items, PLACEABLE).name, 'cobblestone')
})
await t('ranks: stone family < sand/gravel < planks < logs; biggest stack within a rank; wood when only wood; never a refusal', async () => {
  assert.equal(pickScaffold([stack('sand', 64), stack('dirt', 3)], PLACEABLE).name, 'dirt')
  assert.equal(pickScaffold([stack('oak_log', 5), stack('birch_planks', 2)], PLACEABLE).name, 'birch_planks')
  assert.equal(pickScaffold([stack('dirt', 3), stack('cobblestone', 30)], PLACEABLE).name, 'dirt', 'cobblestone is the pickaxe material: spent after dirt')
  assert.equal(pickScaffold([stack('cobblestone', 30), stack('oak_planks', 64)], PLACEABLE).name, 'cobblestone', 'but still before any wood')
  assert.equal(pickScaffold([stack('oak_log', 5)], PLACEABLE).name, 'oak_log', 'a bot holding only wood still climbs')
  assert.equal(pickScaffold([stack('apple', 5)], PLACEABLE), null)
  assert.equal(scaffoldRank('oak_log') > scaffoldRank('oak_planks') && scaffoldRank('oak_planks') > scaffoldRank('cobblestone') && scaffoldRank('cobblestone') > scaffoldRank('gravel') && scaffoldRank('gravel') > scaffoldRank('dirt'), true)
})

const dirtBlock = { name: 'dirt', digTime: () => 750 }                                   // no harvestTools: the hand can break it
const stoneBlock = { name: 'stone', harvestTools: { 1: true }, digTime: t => (t ? 400 : 7500) }
await t('TRAVEL DIG on dirt holding a pickaxe: hold the dirt, not the wooden pickaxe (it returned the pickaxe first)', async () => {
  const items = [pick('wooden_pickaxe', 40, 59), stack('dirt', 64)]
  assert.equal(travelTool(dirtBlock, items, items[0]).name, 'dirt')
})
await t('TRAVEL DIG control: stone with a pickaxe still gets the pickaxe', async () => {
  const items = [pick('stone_pickaxe', 100), stack('dirt', 64)]
  assert.equal(travelTool(stoneBlock, items, items[0]).name, 'stone_pickaxe')
})

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
await t('WIRED: no bare unequip anywhere in src; the five escape scaffold sites go through scaffoldFor', async () => {
  const r = strip(readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8'))
  assert.equal((r.match(/\.unequip\??\.?\(/g) ?? []).length, 0, 'reflex must empty the hand through safeEmptyHand')
  assert.equal((r.match(/await safeEmptyHand\(bot, '/g) ?? []).length, 7, 'six + the climbflood-01 sidestep (escapeStairUp)')
  assert.equal((r.match(/scaffoldFor\(bot, '/g) ?? []).length, 4, 'four LIVE placement sites (the dead flooded_pillar pick is gone)')
  const tf = strip(readFileSync(new URL('../src/toolfor.mjs', import.meta.url), 'utf8'))
  assert.equal((tf.match(/\.unequip\??\.?\(/g) ?? []).length, 2, 'only the two GUARDED unequips (applyToolPolicy, emptyHand)')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
