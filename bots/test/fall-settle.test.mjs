// THE DESCENT WAS JUDGED BEFORE GRAVITY HAD RUN.
//
// `rideFloorDown`'s dig-down branch sampled the bot's y the instant digBounded
// returned. A bot does not teleport downward when the block under it goes: it
// accelerates from rest, and one block takes about nine ticks (~450ms). So a
// dig that WORKED measured fell=0 and reported "dug but did not descend", and
// because escapePlan is stateless the lattice re-picked the same rung forever.
//
// Measured before the fix: `dig_down` chosen 120 times by the one bot above the
// climb ceiling and scored successful ONCE. 138 of 200 lattice failures
// fleet-wide read exactly that string -- while that same bot descended
// y=150 -> 146 -> 144 across the window. It was working the whole time.
import assert from 'node:assert'
import test from 'node:test'
import { settleForFall, FALL_SETTLE_MS, FALL_POLL_MS } from '../src/reflex.mjs'

// A fake clock, so a timing postcondition is testable without a server. That is
// the point: the old one could only be checked against a live world, which is
// why it stayed wrong.
const harness = (samples, { onGround = () => true } = {}) => {
  let t = 0, i = 0
  const bot = { entity: { position: { y: samples[0] }, onGround: onGround(0) } }
  return {
    bot,
    opts: {
      now: () => t,
      sleep: async ms => {
        t += ms; i = Math.min(i + 1, samples.length - 1)
        bot.entity.position.y = samples[i]
        bot.entity.onGround = onGround(i)
      },
    },
  }
}

test('a bot that falls one block is CREDITED, not called a failure', async () => {
  // y 144 -> 143.6 -> 143.0, landing. The old code read the first sample only.
  const { bot, opts } = harness([144, 143.6, 143.0, 143.0])
  const fell = await settleForFall(bot, 144, opts)
  assert.ok(fell >= 0.5, `expected a credited fall, got ${fell}`)
  assert.ok(Math.abs(fell - 1) < 0.001, `expected ~1 block, got ${fell}`)
})

test('IT RETURNS EARLY once the bot is down and settled', async () => {
  // A working dig must not pay the whole budget on every descent.
  const { bot, opts } = harness([144, 143.0, 143.0, 143.0, 143.0])
  const t0 = opts.now()
  await settleForFall(bot, 144, opts)
  assert.ok(opts.now() - t0 < FALL_SETTLE_MS,
    `settled in ${opts.now() - t0}ms, budget is ${FALL_SETTLE_MS}`)
})

test('still falling is NOT settled -- it keeps watching', async () => {
  // Mid-air at the first sample below the threshold; onGround false throughout
  // until the end. It must report the FULL fall, not the first 0.5.
  const { bot, opts } = harness([170, 169.4, 167.9, 165.2, 162.0, 162.0],
                                { onGround: i => i >= 5 })
  const fell = await settleForFall(bot, 170, opts)
  assert.ok(fell >= 7.9, `expected the whole fall, got ${fell}`)
})

test('A DIG THAT REALLY DID NOTHING STILL FAILS, and within the budget', async () => {
  // This is the case the postcondition exists for. It must not become a pass.
  const { bot, opts } = harness([100, 100, 100, 100, 100, 100, 100])
  const t0 = opts.now()
  const fell = await settleForFall(bot, 100, opts)
  assert.equal(fell, 0, 'no movement is no descent')
  assert.ok(opts.now() - t0 <= FALL_SETTLE_MS + FALL_POLL_MS,
    `waited ${opts.now() - t0}ms, budget ${FALL_SETTLE_MS}`)
})

test('a bot that rises is never credited with a descent', async () => {
  const { bot, opts } = harness([100, 101, 102, 102])
  assert.equal(await settleForFall(bot, 100, opts), 0)
})

test('missing position readings do not throw or fabricate a fall', async () => {
  const bot = { entity: { position: {} } }
  const fell = await settleForFall(bot, 100, { now: (() => { let t = 0; return () => (t += 400) })(), sleep: async () => {} })
  assert.equal(fell, 0)
  const headless = {}
  assert.equal(await settleForFall(headless, 100,
    { now: (() => { let t = 0; return () => (t += 400) })(), sleep: async () => {} }), 0)
})

test('the budget covers a real fall: one block is ~450ms', () => {
  assert.ok(FALL_SETTLE_MS >= 900, 'must cover more than a single block of fall')
  assert.ok(FALL_POLL_MS <= 50, 'one Minecraft tick is 50ms; finer buys nothing')
})

// --- THE WIRING, because the helper being right is not the fix -------------

test('the descent branch actually AWAITS the settle', async () => {
  // A structural assertion, which CLAUDE.md admits for exactly this: "a config
  // value is wired into the runner". The helper can be perfect and the bug
  // remain, if the call site still samples y immediately -- and that is the
  // line that was wrong.
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  // ALL THREE descent rungs had it. The bug was found in dig_down and grep then
  // showed the identical line in ride_floor_down (0 successes in 23) and
  // step_off (1 in 35). Fixing one and shipping would have left two.
  const waits = src.match(/const fell = await settleForFall\(bot, yBefore\)/g) ?? []
  assert.equal(waits.length, 3,
    `all three descent postconditions must wait for gravity; found ${waits.length}`)
  assert.doesNotMatch(src, /const fell = yBefore - \(bot\.entity\?\.position\?\.y/,
    'the immediate-sample form is the bug and must not come back')
})
