// NO TOOL THAT CAN BREAK IT IS `missing_tool`, NOT `no_path` -- and it is said before the walk.
// Both engines, 09-29 (24 h, 80b3bbd): 2,265 of 2,663 stone-family `no_path` failures were "Digging aborted" after a
// SUCCESSFUL reach probe; `no_path` is learnable evidence, so the fleet learned to avoid gather cobblestone for want of
// a pickaxe. With last-swing, a spent copy still swings; this guard is for a bot with nothing that can.
import assert from 'node:assert/strict'
process.env.LOG_DIR = process.env.LOG_DIR || '/tmp/mcbot-test-logs-missingtool'
const { createRequire } = await import('node:module')
const req = createRequire(import.meta.url)
const registry = req('prismarine-registry')('1.21.8')
const Block = req('prismarine-block')(registry)
const { Vec3 } = req('vec3')
const { SKILLS, harvestRefused } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const blk = (name, pos) => { const b = Block.fromStateId(registry.blocksByName[name].defaultState, 0); b.position = pos; return b }
const pick = (name, left) => { const d = registry.itemsByName[name]; return { name, type: d.id, count: 1, maxDurability: d.maxDurability, durabilityUsed: d.maxDurability - left } }

await t('harvestRefused (real 1.21.8 blocks): stone with no pickaxe -> refused; a spent copy (last swing) or a good one -> not', () => {
  const stone = blk('stone', new Vec3(0, 0, 0))
  assert.equal(harvestRefused(stone, []), true)
  assert.equal(harvestRefused(stone, [pick('stone_pickaxe', 1)]), false, 'last-swing: one use still swings')
  assert.equal(harvestRefused(stone, [pick('wooden_pickaxe', 40)]), false)
  assert.equal(harvestRefused(stone, [pick('stone_pickaxe', 0)]), true, 'a copy at 0 uses is nothing')
  assert.equal(harvestRefused(blk('dirt', new Vec3(0, 0, 0)), []), false, 'the hand breaks dirt')
})

function gatherBot (items) {
  const walks = []
  const at = new Vec3(4, 63, 0)
  const bot = {
    registry, version: '1.21.8', health: 20, food: 20, game: { dimension: 'overworld' },
    entity: { position: new Vec3(0, 64, 0), onGround: true, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => items },
    findBlocks: ({ matching }) => (matching === registry.blocksByName.cobblestone.id || (Array.isArray(matching) && matching.includes(registry.blocksByName.cobblestone.id)) ? [at] : []),
    findBlock: () => null,
    blockAt: p => (p && p.x === at.x && p.y === at.y && p.z === at.z) ? blk('cobblestone', at) : blk(p && p.y < 64 ? 'stone' : 'air', p),
    pathfinder: { goto: async g => { walks.push(g) }, setGoal () {}, stop () {}, movements: {}, setMovements () {} },
    on () {}, off () {}, once () {}, removeListener () {}, lookAt: async () => {}, equip: async () => {}, dig: async () => { throw new Error('Digging aborted') },
    players: {}, entities: {}, waitForTicks: async () => {},
  }
  return { bot, walks }
}
const run = (bot) => SKILLS.gather.run({ bot }, { block: 'cobblestone', count: 2 }, new AbortController().signal)

await t('DRIVEN: no pickaxe at all -> missing_tool with a pickaxe need, and NO walk (it was three barren rounds then no_path)', async () => {
  const { bot, walks } = gatherBot([])
  const r = await run(bot)
  assert.equal(r.failClass, 'missing_tool', `${r.status} ${r.failClass}: ${r.detail}`)
  assert.equal(walks.length, 0, 'it walked before refusing')
  assert.ok(r.need?.items?.includes('wooden_pickaxe') && r.need.count === 1, 'a prerequisite the goal layer can adopt')
  assert.match(r.detail, /craft a wooden_pickaxe/)
})
await t('POSITIVE CONTROL: the same bot holding a spent pickaxe (last swing) is NOT refused -- the guard never blocks the fix', async () => {
  const { bot } = gatherBot([pick('stone_pickaxe', 1)])
  let r
  try { r = await run(bot) } catch (e) { r = { status: 'threw', failClass: null, detail: String(e?.message ?? e) } }
  assert.notEqual(r.failClass, 'missing_tool', r.detail)
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
