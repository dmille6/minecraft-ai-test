// BOTS DIE UNDERGROUND. THEY LOSE THEIR TIME AT THE SURFACE.
//
// Measured over seven days, by elevation band:
//
//   y  60-79   187,444 events  48%   stranded 5,115 · no_path 3,340
//   y  80-99    50,929 events  13%   no_path 4,150 · stranded 2,686
//   y -60--41   40,696 events  10%   <- the "deep caves" everyone assumes
//   canopy/tree    503 events   0.1%
//
// 61% of activity is at or above sea level and that is where stranding
// dominates. Miner01 sat at y=89 and Scout02 at y=84, the two bots furthest
// from home, reporting "no route out of here even with digging allowed, 26
// blocks short". Twenty-six blocks is not distance and not terrain -- it is a
// local descent constraint: BOTH movement configs cap maxDropDown at 6, so a
// bot whose every exit is a 7+ block drop has no legal first move, and the
// dig-assisted retry cannot invent one.
//
// The repair is a second retry with maxDropDown raised to 8, canDig FALSE (a
// controlled step down, not the excavation that manufactures one-way shafts)
// and allow1by1towers FALSE (or A* answers "I cannot get down" by climbing
// higher). These pin when it fires and, more importantly, when it must not.
import assert from 'node:assert'

process.env.LOG_DIR = '/tmp/mcbot-test-logs-descent'
process.env.STATE_DIR = '/tmp/mcbot-test-state-descent'
process.env.BOT_NAME = 'TestBot'
const { SKILLS } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c),
                          distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z),
                          clone: () => V(x, y, z) })

/**
 * A bot on a perch: no route on foot, none with digging, but one if a bigger
 * drop is permitted. Records which movement configs were installed.
 */
function perchedBot({ y = 84, health = 20, descentWorks = true } = {}) {
  const used = []
  let descended = false
  let pos = V(300, y, -200)
  const bot = {
    entity: { position: pos, onGround: true, velocity: V(0, 0, 0) },
    health, food: 20, version: '1.21.8',
    registry: { blocksByName: {}, itemsByName: {}, blocks: {} },
    inventory: { items: () => [] },
    blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
    assertNav: () => {}, chat: () => {},
    pathfinder: {
      movements: {}, setMovements() {}, stop() {}, setGoal() {},
      async goto(goal) {
        // Whatever config is active decides whether a route exists.
        if (used[used.length - 1] === 'descent' && descentWorks) {
          descended = true
          pos = V(300, y - 8, -180); bot.entity.position = pos
          return
        }
        // ONCE OFF THE PERCH, ordinary travel works again -- which is the whole
        // point of the repair, and modelling it is what makes the escape
        // observable rather than a bot that drops and re-strands.
        if (descended) {
          pos = V(goal?.x ?? 300, y - 14, goal?.z ?? -150); bot.entity.position = pos
          return
        }
        // On foot and with digging: resolves without moving (the real
        // empty-path case -- a FULFILLED promise, which is what made this
        // class of bug invisible for so long).
      },
      getPathTo: () => ({ status: 'noPath', path: [] }),
    },
    withAscentMovements: async (fn) => { used.push('ascent'); try { return await fn() } finally { used.push('travel') } },
    withDescentMovements: async (fn) => { used.push('descent'); try { return await fn() } finally { used.push('travel') } },
  }
  return { bot, used, pos: () => pos }
}

const goto = (bot, args) => SKILLS.goto.run({ bot }, args, new AbortController().signal)

await t('a perched bot gets a descent retry and escapes', async () => {
  const { bot, used, pos } = perchedBot({ y: 84 })
  const r = await goto(bot, { x: 300, y: 70, z: -150, range: 2 })
  assert.ok(used.includes('descent'), 'the descent config must have been tried')
  assert.ok(pos().y < 84, `the bot must have come down, still at y=${pos().y}`)
  assert.notEqual(r.failClass, 'stranded', 'it escaped, so it must not report stranded')
})

await t('the descent is tried AFTER digging, not instead of it', async () => {
  // Digging is non-destructive to the bot's own routability and cheaper to
  // recover from; dropping eight blocks is the bigger commitment.
  const { bot, used } = perchedBot({ y: 84 })
  await goto(bot, { x: 300, y: 70, z: -150, range: 2 })
  assert.ok(used.indexOf('ascent') < used.indexOf('descent'),
    `dig retry must come first, order was ${used.join(',')}`)
})

await t('a WOUNDED bot is not rescued by dropping it', async () => {
  // Falls are already 169 of 868 deaths. An eight-block drop costs up to 2.5
  // hearts, which is a rescue at full health and a death sentence at low.
  const { bot, used } = perchedBot({ y: 84, health: 10 })
  const r = await goto(bot, { x: 300, y: 70, z: -150, range: 2 })
  assert.ok(!used.includes('descent'), 'must not drop a bot at health 10')
  assert.equal(r.failClass, 'stranded', 'it should fail honestly instead')
})

await t('a bot BELOW sea level gets no descent retry', async () => {
  // Underground the answer is to climb, and `surface` owns that. Dropping
  // further would be the opposite of the repair.
  const { bot, used } = perchedBot({ y: 40 })
  await goto(bot, { x: 300, y: 40, z: -150, range: 2 })
  assert.ok(!used.includes('descent'),
    'below sea level this must stay out of the way of surface()')
})

await t('the descent is attempted at most once per goto', async () => {
  const { bot, used } = perchedBot({ y: 84, descentWorks: false })
  await goto(bot, { x: 300, y: 70, z: -150, range: 2 })
  assert.equal(used.filter(u => u === 'descent').length, 1,
    'a bot needing a drop on every leg is not travelling either')
})

await t('a descent that does not move still fails honestly', async () => {
  const { bot } = perchedBot({ y: 84, descentWorks: false })
  const r = await goto(bot, { x: 300, y: 70, z: -150, range: 2 })
  assert.equal(r.failClass, 'stranded')
  assert.match(r.detail, /no route out of here/)
})

await t('movements are always handed back', async () => {
  // index.mjs owns setMovements. A rescue that leaks its config would leave the
  // whole fleet dropping eight blocks as ordinary travel.
  const { bot, used } = perchedBot({ y: 84 })
  await goto(bot, { x: 300, y: 70, z: -150, range: 2 })
  assert.equal(used[used.length - 1], 'travel',
    `the last config installed must be travel, order was ${used.join(',')}`)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
