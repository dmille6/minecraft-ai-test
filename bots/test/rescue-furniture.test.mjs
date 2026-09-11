// A STRANDED BOT MAY STAND ON ITS FURNITURE.
//
// placebo-c-Bravo, 2026-09-10 06:15 -> 2026-09-11 01:00 UTC, on the end of an
// unfinished bridge at y=91 over a 22-block drop, one diagonal off the bridge
// behind it. It held 3 chests, 1 crafting_table, 1 glass, 1 sand, 3 ladders,
// 43 bamboo. Every rung refused: rideFloorDown "no placeable blocks left",
// the maroon state "nothing in the inventory to pillar with", step_off
// "tread=false". One chest on the furnace's side is a tread; a bot that can
// place one block can walk its own bridge back.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
process.env.OLLAMA_MODEL ??= 'qwen2.5:7b-instruct'
const { rescueBlocks, RESCUE_FURNITURE, RESCUE_BLOCK } = await import('../src/skills.mjs')
const { placeableItems, PLACEABLE_PARTS } = await import('../src/reflex.mjs')
const { FALLING, placingAgainst, INTERACTIVE } = await import('../src/scaffold.mjs')
const { scaffoldCandidate } = await import('../src/reflex.mjs')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const bot = inv => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })) } })
const BRAVO = { stick: 4, bamboo: 43, leaf_litter: 128, crafting_table: 1, kelp: 23, bucket: 1, ladder: 3,
                oak_sapling: 66, wooden_pickaxe: 4, stone_pickaxe: 3, chest: 3, sand: 1, glass: 1 }

t('Bravo has something to stand on: chests, a table and glass count for both lists', () => {
  const r = rescueBlocks(bot(BRAVO)).map(i => i.name)
  assert.deepEqual(new Set(r), new Set(['crafting_table', 'glass']), `chests are 14/16 high and stay off: ${r.join(',')}`)
  const p = placeableItems(bot(BRAVO)).map(i => i.name)
  assert.ok(!p.includes('chest') && p.includes('crafting_table') && p.includes('glass'), p.join(','))
})

t('cheap blocks are spent before furniture, in both lists', () => {
  const inv = { crafting_table: 1, glass: 3, dirt: 2, cobblestone: 5 }
  assert.deepEqual(rescueBlocks(bot(inv)).slice(0, 2).map(i => i.name).sort(), ['cobblestone', 'dirt'])
  assert.equal(rescueBlocks(bot(inv))[0].name !== 'crafting_table', true)
  const p = placeableItems(bot(inv)).map(i => i.name)
  assert.ok(p.indexOf('glass') > p.indexOf('dirt') && p.indexOf('crafting_table') > p.indexOf('cobblestone'), p.join(','))
})

t('sand and gravel are still not a rescue block, and leaves and litter are not furniture', () => {
  const r = rescueBlocks(bot({ sand: 5, gravel: 5, oak_leaves: 9, leaf_litter: 128, oak_sapling: 66, bamboo: 43 }))
  assert.deepEqual(r, [], 'a tread that falls, decays, or is not solid is not a tread')
  for (const n of ['oak_leaves', 'leaf_litter', 'oak_sapling', 'bamboo', 'ladder', 'bucket', 'sand', 'gravel', 'chest', 'trapped_chest']) {
    assert.ok(!RESCUE_FURNITURE.test(n), n)
  }
  for (const n of FALLING) assert.ok(!RESCUE_FURNITURE.test(n), `${n} must never be furniture`)
})

t('nothing that was placeable before stopped being placeable', () => {
  for (const n of ['dirt', 'cobblestone', 'oak_planks', 'birch_log', 'deepslate', 'netherrack']) {
    assert.ok(RESCUE_BLOCK.test(n), n)
    assert.equal(placeableItems(bot({ [n]: 1 })).length, 1, n)
  }
})

t('every pillar/tread placement in reflex.mjs takes the ordered list, not a bare find', () => {
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal((src.match(/items\(\)\.find\(it => PLACEABLE\.test/g) ?? []).length, 0, 'a bare find would spend a chest before dirt')
  assert.ok((src.match(/const item = placeableItems\(bot\)\[0\]/g) ?? []).length >= 2, 'both placement sites use the ordered list')
})

t('PLACEABLE is exactly the union of the cheap list and the furniture list', () => {
  const { cheap, furniture, all } = PLACEABLE_PARTS
  for (const n of ['dirt', 'birch_log', 'crimson_stem', 'chest', 'glass', 'crafting_table', 'oak_leaves', 'leaf_litter', 'bamboo', 'ladder', 'pumpkin_stem']) {
    assert.equal(all.test(n), cheap.test(n) || furniture.test(n), n)
  }
})

t('self-sourcing never digs furniture: glass drops nothing, a bookshelf drops books', () => {
  for (const n of ['glass', 'bookshelf', 'crafting_table', 'furnace']) assert.equal(scaffoldCandidate(n), false, n)
  for (const n of ['dirt', 'cobblestone', 'oak_log']) assert.equal(scaffoldCandidate(n), true, n)
})

const ta = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
await ta('placing against a furnace sneaks for the click and releases after; against stone it does not touch the controls', async () => {
  const log = []
  const b = { setControlState: (k, v) => log.push(`${k}=${v}`) }
  let during = null
  await placingAgainst(b, { name: 'furnace' }, async () => { during = log.slice(); return 'placed' })
  assert.deepEqual(during, ['sneak=true']); assert.deepEqual(log, ['sneak=true', 'sneak=false'])
  log.length = 0
  await placingAgainst(b, { name: 'stone' }, async () => {})
  assert.deepEqual(log, [], 'sneak is a control state the reflex layer owns; touch it only when needed')
  log.length = 0
  await placingAgainst(b, { name: 'crafting_table' }, async () => { throw new Error('mistimed') }).catch(() => {})
  assert.deepEqual(log, ['sneak=true', 'sneak=false'], 'released on a throw too')
  for (const n of ['chest', 'barrel', 'oak_door', 'oak_trapdoor', 'lever', 'anvil', 'red_bed']) assert.ok(INTERACTIVE.test(n), n)
  for (const n of ['stone', 'dirt', 'oak_planks', 'glass', 'oak_log']) assert.ok(!INTERACTIVE.test(n), n)
})

t('every placeBlock in skills.mjs and reflex.mjs is issued inside placingAgainst', () => {
  for (const f of ['skills', 'reflex']) {
    const src = readFileSync(new URL(`../src/${f}.mjs`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const calls = (src.match(/bot\.(?:placeBlock|_placeBlockWithOptions)\(/g) ?? []).length
    const wrapped = (src.match(/placingAgainst\(bot, \w+, \(\) =>/g) ?? []).length
    assert.ok(calls > 0, `${f}: no placeBlock at all?`)
    // rideFloorDown issues one of two calls from a single thunk inside one wrapper.
    assert.ok(wrapped >= calls - (f === 'skills' ? 1 : 0), `${f}: ${calls} placeBlock calls, ${wrapped} wrapped`)
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
