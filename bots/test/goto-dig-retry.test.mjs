// IF IT WALKED OUT, A WALK BACK EXISTS -- UNLESS WE BUILT THE TRAP.
//
// Every bot spawns at home, so a route home existed at least once. What breaks
// the symmetry is our own stack: `mine` staircases down and pillarOut towers
// up, while navigation runs canDig=false and never digs. One layer manufactures
// terrain another layer may not cross, and the bot that dug the shaft is the
// one bot that cannot climb it -- 25 of 44 logged deposit failures were this,
// filed as "no route out of here" as though the world were at fault.
//
// goto now takes ONE dig-assisted retry before calling a bot stranded. These
// tests pin that it happens, that it happens once, and that the dig-capable
// config is always handed back.
import assert from 'node:assert'

process.env.LOG_DIR = '/tmp/mcbot-test-logs-gotodig'
process.env.STATE_DIR = '/tmp/mcbot-test-state-gotodig'
process.env.BOT_NAME = 'TestBot'
const { SKILLS } = await import('../src/skills.mjs')

let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const V = (x, y, z) => ({ x, y, z, offset: (a,b,c) => V(x+a,y+b,z+c),
                          distanceTo: o => Math.hypot(x-o.x, y-o.y, z-o.z), clone: () => V(x,y,z) })

/**
 * @param diggingWorks whether a route exists once digging is permitted
 */
function trappedBot({ diggingWorks }) {
  const borrowed = []
  let digging = false
  const bot = {
    entity: { position: V(200, 30, 200), onGround: true, velocity: V(0,0,0) },
    health: 20, food: 20, version: '1.21.8',
    registry: { blocksByName: {}, itemsByName: {}, blocks: {} },
    inventory: { items: () => [] },
    blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
    assertNav: () => {},
    pathfinder: {
      movements: {}, setMovements() {}, stop() {}, setGoal() {},
      // On foot: resolves without moving (the real empty-path case -- a
      // FULFILLED promise, which is why this bug was invisible for so long).
      // With digging: actually arrives.
      goto: async () => {
        if (digging && diggingWorks) bot.entity.position = V(28, 79, 0)
      },
    },
    withAscentMovements: async (fn) => {
      borrowed.push('in'); digging = true
      try { return await fn() } finally { digging = false; borrowed.push('out') }
    },
    on: () => {}, off: () => {}, once: () => {}, removeListener: () => {},
    waitForTicks: async () => {}, chat() {},
  }
  return { bot, borrowed }
}

const run = (bot) => SKILLS.goto.run({ bot }, { x: 28, y: 79, z: 0, range: 2 },
                                     new AbortController().signal)

await t('a bot with no route on foot retries WITH digging', async () => {
  const { bot, borrowed } = trappedBot({ diggingWorks: true })
  const r = await run(bot)
  assert.ok(borrowed.length > 0, 'it must try the dig-capable config before giving up')
  assert.equal(r.status, 'success', r.detail)
})

await t('the dig-capable config is always given back', async () => {
  const { bot, borrowed } = trappedBot({ diggingWorks: false })
  await run(bot)
  assert.deepEqual(borrowed.slice(0, 2), ['in', 'out'],
    'canDig=true must not outlive the retry, or travel starts tunnelling everywhere')
})

await t('genuinely unreachable still fails honestly, and says digging was tried', async () => {
  const { bot } = trappedBot({ diggingWorks: false })
  const r = await run(bot)
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'stranded')
  assert.match(r.detail, /even with digging allowed/)
})

await t('the retry happens at most once per goto', async () => {
  // A bot that must tunnel every leg is excavating, not travelling, and the
  // travel budget should say so rather than quietly funding a mining trip.
  const { bot, borrowed } = trappedBot({ diggingWorks: false })
  await run(bot)
  assert.equal(borrowed.filter(x => x === 'in').length, 1)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
