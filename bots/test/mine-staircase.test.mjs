// DIGGING IS NOT DESCENDING.
//
// `mine` dug the block under the bot and stepped sideways every third block.
// Nothing checked that the bot ever MOVED, and `bot.dig()` does not move it.
// What the fleet produced over 23 days, 80 bots:
//
//     shape ratio (horizontal per vertical)   0.25     (a staircase is ~1.0)
//     iron ore gathered                       0        in 65 attempts
//     deepest bot                             y=56     (iron peaks at y≈15)
//
// The shape was the cause, not a symptom: a sheer shaft has to be climbed out
// of, the exit contract priced that at 59 scaffold blocks at iron depth, and
// gatherers carry logs -- which are not scaffold. So the descent refused itself
// three rungs above the thing it was sent for.
//
// These tests are all about the SHAPE and the MOVEMENT. They run against a
// mutable micro-world with a pathfinder that only moves the bot when there is
// somewhere to move to, because the failure being guarded against is precisely
// a bot that digs and stays put.
import assert from 'node:assert'
import { V, AIR, STONE } from './helpers/microworld.mjs'
import { SKILLS, stairBearing } from '../src/skills.mjs'

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const key = (x, y, z) => `${x},${y},${z}`

/**
 * Solid stone everywhere below y=64, air above, and a bot standing on it.
 * `canMove` lets a test simulate a pathfinder that cannot deliver the bot.
 */
function mineWorld ({ canMove = true, yaw = 0, drift = false } = {}) {
  const carved = new Set()
  const digs = []
  const events = []
  const blockAt = p => {
    if (carved.has(key(p.x, p.y, p.z))) return AIR
    return p.y < 64 ? STONE : AIR
  }
  const bot = {
    entity: { position: new V(200, 64, 200), yaw },
    health: 20, food: 20, oxygenLevel: 300,
    heldItem: { type: 1 },
    blockAt: p => {
      const b = blockAt(p)
      // canHarvest/bestTool need the same object shape the real registry gives.
      return { ...b, position: new V(p.x, p.y, p.z), canHarvest: () => true,
               digTime: () => 100, harvestTools: undefined, material: 'rock' }
    },
    inventory: { items: () => [
      { name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 0 },
      { name: 'cobblestone', count: 512 },
    ] },
    equip: async () => {},
    dig: async b => { digs.push(b.position); carved.add(key(b.position.x, b.position.y, b.position.z)) },
    pathfinder: {
      goto: async goal => {
        if (drift) {
          // A LIVE PATHFINDER FAILS BY GOING SOMEWHERE ELSE, not by standing
          // still. It times out mid-route, mobs shove, a partial path resolves.
          // The bot moves more than 0.7 blocks and arrives nowhere useful.
          bot.entity.position = bot.entity.position.offset(0, 0, 1)
          return
        }
        if (!canMove) return
        // Only step in if the cell and its headroom are actually open.
        const at = new V(goal.x, goal.y, goal.z)
        if (blockAt(at) !== AIR || blockAt(at.offset(0, 1, 0)) !== AIR) return
        bot.entity.position = at
        // A REAL PATHFINDER SWINGS THE YAW. It looks ahead to the next node, so
        // the bot's facing wobbles by tens of degrees every step. Without this,
        // a bearing recomputed per step LOOKS stable in a fixture and curls the
        // stair into itself on the fleet -- the test would assert nothing.
        bot.entity.yaw += 0.9
      },
      setGoal: () => {},
      stop: () => {},
    },
    setControlState: () => {}, clearControlStates: () => {},
    registry: { blocksByName: {}, itemsByName: {} }, players: {},
    _digs: digs, _events: events,
  }
  return bot
}

const run = (bot, y) => SKILLS.mine.run({ bot }, { y }, new AbortController().signal)

// --- the shape is the whole point -------------------------------------------

await t('the bot descends a 1:1 staircase, not a shaft', async () => {
  const bot = mineWorld()
  const start = bot.entity.position.clone()
  await run(bot, 50)
  const drop = start.y - bot.entity.position.y
  const across = Math.hypot(bot.entity.position.x - start.x, bot.entity.position.z - start.z)
  assert.ok(drop >= 10, `descended only ${drop} blocks`)
  const ratio = across / drop
  assert.ok(ratio > 0.9 && ratio < 1.1,
    `shape ratio ${ratio.toFixed(2)}; the shipped shaft measured 0.25 and a staircase is 1.0`)
})

await t('it actually reaches the requested depth', async () => {
  const bot = mineWorld()
  const r = await run(bot, 40)
  assert.equal(r.status, 'success', `got ${r.status}: ${r.detail}`)
  assert.ok(bot.entity.position.y <= 41,
    `reported success at y=${bot.entity.position.y}, having been asked for y=40`)
})

await t('it opens headroom, so the bot is never walking into its own ceiling', async () => {
  const bot = mineWorld()
  await run(bot, 60)
  // Every cell the bot stood in must have had the block above it removed too.
  const dug = new Set(bot._digs.map(p => key(p.x, p.y, p.z)))
  const feet = bot.entity.position
  assert.ok(dug.has(key(feet.x, feet.y + 1, feet.z)),
    'the bot is standing in a cell whose headroom was never dug')
})

// --- the failure that widened the shaft -------------------------------------

await t('a bot that digs but cannot move STOPS, and does not report success', async () => {
  const bot = mineWorld({ canMove: false })
  const r = await run(bot, 40)
  assert.equal(r.status, 'unknown', `got ${r.status}: ${r.detail}`)
  assert.equal(r.failClass, 'unverified')
  assert.ok(/could not stand in it/.test(r.detail), `unhelpful detail: ${r.detail}`)
})

await t('and it stops after ONE step, rather than carving a wider shaft', async () => {
  const bot = mineWorld({ canMove: false })
  await run(bot, 40)
  // One tread + one headroom cell. The old loop would have run all 90 steps.
  assert.ok(bot._digs.length <= 2,
    `dug ${bot._digs.length} blocks while going nowhere — that is the widened shaft`)
})

await t('drifting sideways is not arriving, and the descent stops', async () => {
  // The check this replaces was `moved >= 0.7` -- pure displacement. A bot that
  // slid a metre at the same elevation passed it, and the next iteration cut a
  // tread from the new position: a trench, reported as a descent in progress.
  const bot = mineWorld({ drift: true })
  const r = await run(bot, 40)
  assert.equal(r.status, 'unknown', `got ${r.status}: ${r.detail}`)
  assert.equal(r.failClass, 'unverified')
  assert.ok(bot._digs.length <= 2,
    `dug ${bot._digs.length} blocks while drifting — that is the trench`)
})

await t('running out of steps is not the same as arriving', async () => {
  // The loop is capped at 90 steps and used to return the same `success` as a
  // real arrival. A cleared avoid-rule on a descent that stopped 40 blocks
  // short is how a bot learns that mining works when it does not.
  const bot = mineWorld()
  const r = await run(bot, -50)          // unreachable inside the cap
  assert.equal(r.status, 'unknown', `got ${r.status}: ${r.detail}`)
  assert.ok(/short of the requested/.test(r.detail), `unhelpful detail: ${r.detail}`)
})

// --- the bearing ------------------------------------------------------------

await t('the bearing is cardinal, and holds for the whole descent', async () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.3, 2.9]) {
    const b = stairBearing({ entity: { yaw } })
    assert.equal(Math.abs(b.x) + Math.abs(b.z), 1,
      `yaw ${yaw} gave a diagonal bearing ${JSON.stringify(b)}; a diagonal tread needs ` +
      'two cells opened per step and the bot clips the corner')
  }
  // Held, not recomputed: the stair must be straight, or it curls into itself.
  const bot = mineWorld()
  const start = bot.entity.position.clone()
  await run(bot, 50)
  const dx = bot.entity.position.x - start.x, dz = bot.entity.position.z - start.z
  assert.ok(dx === 0 || dz === 0,
    `stair wandered to (${dx}, ${dz}); it should run along one axis`)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
