// mineflayer's findBlock asks the matcher about PALETTE blocks first (Block.fromStateId(stateId, 0): position null)
// to decide whether a chunk section is worth scanning at all, and only then about real blocks with positions. A
// matcher that reads b.position throws on the very first call, so deposit never finds a chest at all. The test
// doubles in deposit-town/deposit-demand never call the matcher, which is how this reached the fleet: on the
// recovery-ladder-01 canary (3eb1bec, 2026-09-13) 6 of 6 deposits failed with
// "Cannot read properties of null (reading 'x')". The double here calls the matcher the way mineflayer does.
import assert from 'node:assert/strict'
import { SKILLS } from '../src/skills.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c), distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z), clone: () => V(x, y, z) })

function bot ({ items, exclude = [] }) {
  const chestBlock = { position: V(30, 79, 0), type: 1, name: 'chest' }
  const paletteBlock = { position: null, type: 1, name: 'chest' }          // what mineflayer hands the matcher first
  const deposited = []; const matcherCalls = []
  const b = {
    entity: { position: V(28, 79, 0), onGround: true, velocity: V(0, 0, 0) }, health: 20, food: 20, version: '1.21.8',
    registry: { blocks: { 1: { name: 'chest' } }, blocksByName: {}, itemsByName: {} },
    inventory: { items: () => items },
    findBlock: ({ matching }) => { matcherCalls.push('palette'); if (!matching(paletteBlock)) return null; matcherCalls.push('real'); return matching(chestBlock) ? chestBlock : null },
    blockAt: (p) => p && p.y > 79 ? { name: 'air', boundingBox: 'empty' } : { name: 'grass_block', boundingBox: 'block' },
    pathfinder: { movements: {}, setMovements () {}, setGoal () {}, stop () {}, goto: async () => {} },
    openContainer: async () => ({ deposit: async (type, _m, count) => deposited.push(count), close: () => {} }),
    on: () => {}, off: () => {}, once: () => {}, removeListener: () => {}, waitForTicks: async () => {}, chat () {},
  }
  return { bot: b, deposited, matcherCalls, run: (opts = {}) => SKILLS.deposit.run({ bot: b }, {}, new AbortController().signal, opts) }
}

await t('the chest matcher survives the palette block (position null) and then accepts the real chest', async () => {
  const { deposited, matcherCalls, run } = bot({ items: [{ type: 5, name: 'oak_log', count: 12 }] })
  const r = await run()
  assert.doesNotMatch(String(r.detail), /reading 'x'|Cannot read properties/, `the matcher threw: ${JSON.stringify(r)}`)
  assert.deepEqual(matcherCalls, ['palette', 'real'], 'the palette block must pass the matcher so the real scan runs')
  assert.equal(r.status, 'success', r.detail); assert.deepEqual(deposited, [12])
})
await t('with an exclusion list the palette block still passes and the excluded real chest is skipped', async () => {
  const { matcherCalls, run } = bot({ items: [{ type: 5, name: 'oak_log', count: 2 }] })
  const r = await run({ exclude: [V(30, 79, 0)], noRecovery: true })
  assert.deepEqual(matcherCalls.slice(0, 2), ['palette', 'real'])
  assert.doesNotMatch(String(r.detail), /reading 'x'/, JSON.stringify(r))
  assert.notEqual(r.status, 'success', 'the only chest is excluded, so nothing is deposited')
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
