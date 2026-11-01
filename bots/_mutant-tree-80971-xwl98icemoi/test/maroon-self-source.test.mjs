/**
 * THE CONTRADICTION AT THE HEART OF THE PREREQUISITE MECHANISM.
 *
 * The prerequisite bus assumes a bot can go and fetch what it lacks. A marooned
 * bot cannot -- having no route IS what marooned means -- so for every trapped
 * bot the two mechanisms asked for opposite things. The telemetry was
 * unambiguous once anyone looked at the right field: over 24 hours
 *
 *   _prereq_adopted    479
 *   _prereq_satisfied   22      <- 5% closure
 *   _prereq_abandoned  453      <- all of them at the 15-minute TTL
 *
 * and every sampled detail read `dirt-class: had 0/8 after 916s`. Not partial
 * progress. ZERO, every time, while the bot stood inside walls made of dirt.
 *
 * Also tested here: `_livelock_escape` reported 0% success across 2,296 firings
 * because its event carried a hardcoded status written BEFORE the relocation
 * ran. It was never a broken rescue; it was an unmeasured one.
 */
import assert from 'node:assert'
import { harvestAdjacent, SCAFFOLD_SELF_SOURCE, maroonState } from '../src/reflex.mjs'
import { LIVELOCK_MIN_MOVE } from '../src/cognitive.mjs'

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve()
  .then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c) })

/** A bot in a hole. `walls` maps "dx,dy,dz" -> block name. */
function trappedBot({ walls = {}, tool = null, hand = null } = {}) {
  const inv = []
  if (tool) inv.push({ name: tool, type: 101, count: 1 })
  const dug = []
  return {
    dug, inv,
    entity: { position: V(0, 40, 0) },
    heldItem: hand ? { name: hand, type: 101 } : null,
    inventory: { items: () => inv },
    blockAt(p) {
      const k = `${p.x},${p.y - 40},${p.z}`
      const name = walls[k]
      if (!name) return { name: 'air', boundingBox: 'empty' }
      return {
        name, boundingBox: 'block', position: p,
        // bare hands harvest dirt-likes; stone needs the tool
        canHarvest: type => /^(dirt|sand|gravel)$/.test(name) ? true : type === 101,
        digTime: () => 500,
      }
    },
    async equip(item) { this.heldItem = item },
    async dig(block) {
      dug.push(`${block.position.x},${block.position.y - 40},${block.position.z}`)
      // breaking it yields the item, which the bot picks up
      inv.push({ name: block.name, type: 1, count: 1 })
    },
    stopDigging() {}, clearControlStates() {},
    pathfinder: { setGoal() {} },
  }
}

await t('a bot in a dirt pit sources its own scaffold instead of asking', async () => {
  const bot = trappedBot({ walls: { '1,0,0': 'dirt', '-1,0,0': 'dirt', '0,0,1': 'dirt' } })
  const r = await harvestAdjacent(bot, 2)
  assert.ok(r.gained >= 2, `expected >=2 blocks, got ${r.gained}`)
  assert.ok(r.dug >= 2, 'should have dug the walls')
})

await t('ONE block is enough -- it flips need_scaffold to climb', async () => {
  const bot = trappedBot({ walls: { '1,0,0': 'dirt' } })
  const base = { upIsOpen: true, entombed: false, canStartPath: false }
  assert.equal(maroonState({ ...base, haveBlocks: false }), 'need_scaffold')
  const r = await harvestAdjacent(bot, SCAFFOLD_SELF_SOURCE)
  assert.ok(r.gained >= 1, 'should have taken the one wall available')
  assert.equal(maroonState({ ...base, haveBlocks: true }), 'climb',
    'once anything placeable is held the next maroon check must climb, not ask')
})

await t('never digs the floor -- that drops the bot deeper into the trap', async () => {
  const bot = trappedBot({ walls: { '0,-1,0': 'dirt', '1,0,0': 'dirt' } })
  await harvestAdjacent(bot, 4)
  assert.ok(!bot.dug.includes('0,-1,0'), `dug the floor out from under itself: ${bot.dug}`)
})

await t('never digs the ceiling -- that column is the escape route', async () => {
  const bot = trappedBot({ walls: { '0,2,0': 'dirt', '1,0,0': 'dirt' } })
  await harvestAdjacent(bot, 4)
  assert.ok(!bot.dug.includes('0,2,0'), `dug the escape column: ${bot.dug}`)
})

await t('will not spend a dig on stone it cannot harvest -- that only widens the pit', async () => {
  const bot = trappedBot({ walls: { '1,0,0': 'stone', '-1,0,0': 'stone' } })
  const r = await harvestAdjacent(bot, 4)
  assert.equal(r.dug, 0, 'bare-handed stone drops nothing; digging it is pure loss')
  assert.equal(r.gained, 0)
  assert.ok(r.tried >= 1, 'but it must still REPORT that it looked, so the ask says why')
})

await t('with a pickaxe the same stone is worth taking', async () => {
  const bot = trappedBot({ walls: { '1,0,0': 'stone', '-1,0,0': 'stone' }, tool: 'wooden_pickaxe' })
  const r = await harvestAdjacent(bot, 2)
  assert.ok(r.gained >= 2, `expected stone in hand, got ${r.gained}`)
})

await t('sealed in bedrock, it gains nothing and says so -- THEN the ask is right', async () => {
  const bot = trappedBot({ walls: { '1,0,0': 'bedrock', '-1,0,0': 'bedrock' } })
  const r = await harvestAdjacent(bot, 4)
  assert.equal(r.gained, 0)
  assert.equal(r.dug, 0)
  // bedrock is not PLACEABLE, so it is never even a candidate
  assert.equal(r.tried, 0)
})

await t('a bot that already holds blocks does not dig at all', async () => {
  const bot = trappedBot({ walls: { '1,0,0': 'dirt' }, tool: 'dirt' })
  const r = await harvestAdjacent(bot, 1)
  assert.equal(r.dug, 0, 'nothing to do; do nothing')
  assert.ok(r.skipped)
})

await t('the livelock breaker measures displacement, not arrival', () => {
  // 25-60 blocks is the ASK; the breaker succeeds when perception changes.
  assert.ok(LIVELOCK_MIN_MOVE > 0, 'a threshold of 0 would call standing still a success')
  assert.ok(LIVELOCK_MIN_MOVE < 25,
    'requiring arrival at the goal is what a relocation does not promise')
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
