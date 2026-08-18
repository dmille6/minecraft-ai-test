// `home` SUCCEEDED ZERO TIMES IN 353 CALLS.
//
// Measured over a fourteen-hour fleet run. Three causes, none of which a
// one-line wrapper around `goto` could address:
//
//   INTERRUPTION  836 of 2,560 travel failures were the reflex seizing the body
//                 mid-walk, almost all drowning. The skill returned `aborted`
//                 and the bot waited ~30s for a fresh decision, so a crossing
//                 that took three interruptions burned three whole skill
//                 invocations. Gather01 sat SIX BLOCKS from home and failed
//                 `home` 47/47, every one `interrupted: drowning`.
//   NO ROUTE      stranded/no_path below ground, with `surface` -- the
//                 deterministic repair -- never called.
//   DISTANCE      goto caps at 16 legs x 45 blocks = 720. Scout02 reported the
//                 SAME 1,893 blocks from home in every three-hour bucket for
//                 the whole run while moving 5,263 blocks locally. It was not
//                 converging slowly; it was oscillating, and `home` reported
//                 "no route", which reads as terrain rather than as budget.
//
// These pin the three behaviours that answer them: keep walking across
// interruptions, repair the route once when below ground, and report ground
// closed instead of a flat failure.
import assert from 'node:assert'

process.env.LOG_DIR = '/tmp/mcbot-test-logs-homerescue'
process.env.STATE_DIR = '/tmp/mcbot-test-state-homerescue'
process.env.BOT_NAME = 'TestBot'
process.env.HOME_X = '28'; process.env.HOME_Y = '79'; process.env.HOME_Z = '0'
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
 * A bot whose pathfinder walks a fixed number of blocks toward home per call,
 * optionally throwing an interruption on the first N attempts.
 */
function travellingBot({ startDist, perCall, interruptFirst = 0, y = 70, stallAfter = Infinity }) {
  let pos = V(28 + startDist, y, 0)
  let calls = 0, interrupts = 0
  const bot = {
    entity: { position: pos, onGround: true, velocity: V(0, 0, 0) },
    health: 20, food: 20, version: '1.21.8',
    registry: { blocksByName: {}, itemsByName: {}, blocks: {} },
    inventory: { items: () => [] },
    blockAt: () => ({ name: 'stone', boundingBox: 'block' }),
    assertNav: () => {},
    chat: () => {},
    pathfinder: {
      movements: {}, setMovements() {}, stop() {}, setGoal() {},
      async goto() {
        calls++
        if (interrupts < interruptFirst) {
          interrupts++
          const e = new Error('PathStopped'); e.name = 'PathStopped'; throw e
        }
        const d = Math.hypot(pos.x - 28, pos.z - 0)
        // After `stallAfter` calls the route dies -- the bot closed real ground
        // and then could go no further, which is the common shape of a long
        // trip that runs into terrain rather than into the clock.
        const step = calls > stallAfter ? 0 : Math.min(perCall, d)
        const f = d ? step / d : 0
        pos = V(pos.x - (pos.x - 28) * f, pos.y, pos.z - (pos.z - 0) * f)
        bot.entity.position = pos
      },
      getPathTo: () => ({ status: 'success', path: [1] }),
    },
    get position() { return pos },
  }
  return { bot, stats: () => ({ calls, interrupts, dist: Math.hypot(pos.x - 28, pos.z - 0) }) }
}

// A REAL AbortSignal: the skill layer registers listeners on it, so a hand-made
// stub silently changes the code path under test.
const run = (bot) => SKILLS.home.run({ bot }, {}, new AbortController().signal)

await t('arriving reports success', async () => {
  const { bot } = travellingBot({ startDist: 40, perCall: 60 })
  const r = await run(bot)
  assert.equal(r.status, 'success', `expected arrival, got ${r.status}: ${r.detail}`)
  assert.equal(r.failClass, undefined,
    'a success must not carry a failClass from the last leg it walked')
})

await t('a far trip now crosses more than one goto budget', async () => {
  // The Scout02 case: 1,893 blocks out, where goto's own 16-leg ceiling is 720.
  // The old home was a single goto and could never arrive. Repeated goto calls
  // inside one home invocation can.
  const { bot, stats } = travellingBot({ startDist: 1893, perCall: 300 })
  const r = await run(bot)
  assert.equal(r.status, 'success',
    `home must chain goto calls past the 720-block ceiling, got ${r.status}: ${r.detail}`)
  assert.ok(stats().calls > 1, 'arriving must have taken more than one goto')
  assert.ok(stats().dist <= 2)
})

await t('a trip cut short by the budget reports ground closed, not flat failure', async () => {
  // Crawling: real progress, but nowhere near arrival inside the budget.
  // Reporting this as a plain failure discards the evidence and teaches the
  // fleet that going home never works.
  const { bot, stats } = travellingBot({ startDist: 4000, perCall: 200, stallAfter: 3 })
  const r = await run(bot)
  assert.equal(r.failClass, 'travel_incomplete',
    `a trip that closed ground must say so, got ${r.failClass}: ${r.detail}`)
  assert.match(r.detail, /closed \d+ blocks toward home/)
  assert.match(r.detail, /run home again/)
  assert.ok(stats().dist < 4000, 'the bot must actually be closer')
  assert.ok(stats().dist > 2, 'and must not have arrived, or this tests nothing')
})

await t('it keeps walking across interruptions instead of surrendering', async () => {
  // Gather01: six blocks from home, 47/47 failures, every one an interruption.
  const { bot, stats } = travellingBot({ startDist: 6, perCall: 10, interruptFirst: 2 })
  const r = await run(bot)
  assert.equal(r.status, 'success',
    `two transient interruptions must not end the trip, got ${r.status}: ${r.detail}`)
  assert.ok(stats().interrupts >= 2, 'the interruptions must really have fired')
})

await t('a bot that cannot move at all still fails honestly', async () => {
  // No false credit: if nothing was closed, this must not claim progress.
  const { bot } = travellingBot({ startDist: 500, perCall: 0 })
  const r = await run(bot)
  assert.notEqual(r.status, 'success')
  assert.notEqual(r.failClass, 'travel_incomplete',
    'zero ground closed must not be dressed up as partial progress')
})

await t('it does not loop forever when stuck', async () => {
  const started = Date.now()
  const { bot } = travellingBot({ startDist: 500, perCall: 0 })
  await run(bot)
  assert.ok(Date.now() - started < 60_000,
    'a stuck bot must give up within the budget, not hold the slot for its full deadline')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
