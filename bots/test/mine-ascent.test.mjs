// MINE ONLY DESCENDS, AND ASKING IT TO GO UP RETURNED SUCCESS.
//
// mine()'s loop is `while (y > goalY + 1)`. A bot at y=68 asked to mine to
// y=71 never enters it and falls through to the terminal `success: reached
// y=68`. Live, Scout02 did this every 70 seconds:
//
//     LLM -> mine args={"y":71} reason=Continue mining stone for cobblestone
//     skill mine -> success detail=reached y=68
//     skill returned cleanly but changed nothing
//
// The cognitive layer noticed -- it classified the outcome `neutral` and said
// so in the log -- and then called recordSuccess() for it, which clears any
// avoid rule. The one mechanism that could have broken the loop was being
// reset by the loop. Four of six bots sat in this state, moving zero blocks,
// while every health signal read fine.
import assert from 'node:assert'
import { SKILLS } from '../src/skills.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const V = (x, y, z) => ({
  x, y, z,
  offset: (a, b, c) => V(x + a, y + b, z + c),
  distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z),
  clone: () => V(x, y, z),
  // mine's staircase hands these coordinates to GoalBlock, which needs whole
  // blocks -- a live position is a float.
  floored: () => V(Math.floor(x), Math.floor(y), Math.floor(z)),
})

function mineBot({ y = 68 } = {}) {
  const digs = []
  return {
    digs,
    bot: {
      entity: { position: V(500, y, 500) },   // far from any base
      health: 20, food: 20,
      heldItem: { type: 7, name: 'wooden_pickaxe' },
      inventory: { items: () => [{ name: 'wooden_pickaxe', count: 1, type: 7 }] },
      registry: { itemsByName: { wooden_pickaxe: { id: 7, name: 'wooden_pickaxe' } }, items: {}, blocks: {} },
      blockAt: p => ({
        name: p && p.y < 68 ? 'stone' : 'air',
        position: p,
        boundingBox: p && p.y < 68 ? 'block' : 'empty',
        canHarvest: () => true,
        digTime: () => 500,
        harvestTools: undefined,
        material: 'rock',
      }),
      async dig(b) { digs.push(b) },
      async equip() {},
      async lookAt() {},
      pathfinder: { async goto() {}, movements: {}, setMovements() {} },
      chat() {},
    },
  }
}

// A real AbortSignal: the descent path awaits sleeps that register listeners,
// and a plain `{aborted:false}` object has no addEventListener.
const run = (bot, args) => SKILLS.mine.run({ bot }, args, new AbortController().signal)

await t('mining UP is refused, not reported as success', async () => {
  const { bot, digs } = mineBot({ y: 68 })
  const r = await run(bot, { y: 71 })              // Scout02's exact request
  assert.equal(r.status, 'failed',
    'a call that cannot do anything must not report the outcome it would have had')
  assert.equal(digs.length, 0, 'nothing should have been dug')
})

await t('the refusal names what to do instead', async () => {
  const { bot } = mineBot({ y: 68 })
  const r = await run(bot, { y: 71 })
  assert.match(r.detail, /only digs downward/, r.detail)
  assert.match(r.detail, /gather|goto/, `the model can only act on a named alternative: ${r.detail}`)
})

await t('the failure is classified, so the lessons store can act on it', async () => {
  const { bot } = mineBot({ y: 68 })
  const r = await run(bot, { y: 71 })
  assert.equal(r.failClass, 'already_below')
  assert.match(r.gap ?? '', /^at_y/, `gap should group by elevation: ${r.gap}`)
})

await t('mining to the SAME y is also refused', async () => {
  // y == goalY is the boundary the loop condition already excluded.
  const { bot, digs } = mineBot({ y: 68 })
  const r = await run(bot, { y: 68 })
  assert.equal(r.status, 'failed')
  assert.equal(digs.length, 0)
})

await t('a genuine descent is unaffected', async () => {
  const { bot } = mineBot({ y: 68 })
  const r = await run(bot, { y: 40 })
  assert.notEqual(r.failClass, 'already_below',
    'the guard must not swallow a real descent')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
