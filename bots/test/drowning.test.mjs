/**
 * The three drowning bugs, as assertions.
 *
 * Scout01 drowned 17 times on instance #2 while `reflex: drowning` fired ZERO
 * times. Three separate defects, each found only after deploying a fix for the
 * previous one and watching a live fleet for minutes:
 *
 *   1. the oxygen counter was trusted over the world, so a stale client reading
 *      of "head is air" suppressed real drownings
 *   2. isEntombed() counted water as a wall, so the entombment escape -- 20-30s
 *      of placing blocks into the sea -- held the serial reflex loop while the
 *      oxygen check never got a tick
 *   3. the rescue sat behind a log-spam throttle that the preceding condition
 *      consumed, so the branch that saves the bot was unreachable
 *
 * Three deploys, three fleet restarts, ~40 minutes of measurement windows, and
 * every one of them is provable here in under a millisecond. That is the entire
 * argument for this file existing.
 */
import assert from 'node:assert'
import { assessAir, isEntombedForTest } from '../src/reflex.mjs'
import {
  makeBot, V, ocean, oceanWithStaleChunks, entombed, plain, shaft,
} from './helpers/microworld.mjs'

let n = 0
const ok = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`); n++ }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1 }
}

// --- bug 1: the counter was trusted over the world -------------------------

ok('a bot underwater with no air is drowning', () => {
  const bot = makeBot({ pos: new V(0, 50, 0), blocks: ocean(), oxygen: 0, health: 14 })
  const a = assessAir(bot)
  assert.equal(a.losing, true, 'this is the case that killed Scout01 17 times')
  assert.equal(a.kind, 'drowning')
  assert.equal(a.act, 'swim')
})

ok('losing health with no air is drowning even when the client reports air', () => {
  // THE EXACT LIVE FAILURE. The server was drowning the bot; blockAt() said air.
  const bot = makeBot({
    pos: new V(0, 50, 0), blocks: oceanWithStaleChunks(), oxygen: 0, health: 12,
  })
  const a = assessAir(bot)
  assert.equal(a.losing, true,
    'health is server-authoritative; a stale chunk view must not veto the rescue')
  assert.equal(a.act, 'swim', 'and it must actually swim, not fall through to digging')
})

ok('low air at FULL health with a clear head is a suspect reading, not a rescue', () => {
  // The case the guard was originally written for: oxygen=0, head=air, hp=20/20,
  // nothing happening. Reported once; never acted on.
  const bot = makeBot({ pos: new V(0, 70, 0), blocks: plain(), oxygen: 0, health: 20 })
  const a = assessAir(bot)
  assert.equal(a.losing, false)
  assert.equal(a.suspect, true, 'worth seeing once')
  assert.equal(a.act, 'none')
})

ok('a healthy bot with full air is not assessed at all', () => {
  const a = assessAir(makeBot({ blocks: plain(), oxygen: 300, health: 20 }))
  assert.equal(a.losing, false)
  assert.equal(a.suspect, false, 'no telemetry for a bot that is simply fine')
})

ok('entity.isInWater is believed even when blockAt disagrees', () => {
  const bot = makeBot({
    pos: new V(0, 50, 0), blocks: oceanWithStaleChunks(),
    oxygen: 2, health: 20, isInWater: true,
  })
  assert.equal(assessAir(bot).kind, 'drowning')
})

// --- suffocation must stay distinct ----------------------------------------

ok('a head inside stone suffocates and must NOT swim', () => {
  const bot = makeBot({ pos: new V(0, 40, 0), blocks: entombed(), oxygen: 1, health: 16 })
  const a = assessAir(bot)
  assert.equal(a.losing, true)
  assert.equal(a.kind, 'suffocating', 'jumping into stone does nothing')
  assert.equal(a.act, 'fallthrough', 'this one belongs to the entombment handler')
})

// --- bug 2: water counted as a wall ----------------------------------------

ok('an underwater bot is NOT entombed', () => {
  const bot = makeBot({ pos: new V(0, 50, 0), blocks: ocean(), oxygen: 0, health: 10 })
  assert.equal(isEntombedForTest(bot), false,
    'water is passable; calling it entombment made the wrong rescue hold the loop for 20-30s')
})

ok('a genuinely sealed bot IS entombed', () => {
  const bot = makeBot({ pos: new V(0, 40, 0), blocks: entombed() })
  assert.equal(isEntombedForTest(bot), true,
    'the entombment guard must still catch the case it exists for')
})

ok('a bot at the bottom of an open shaft is not entombed', () => {
  // Miner01's 90 minutes: head open to the sky for 40 blocks.
  const bot = makeBot({ pos: new V(0, 25, 0), blocks: shaft({ bottom: 24, top: 64 }) })
  assert.equal(isEntombedForTest(bot), false, 'open sky overhead is not a tomb')
})

ok('a bot on open ground is not entombed', () => {
  assert.equal(isEntombedForTest(makeBot({ pos: new V(0, 64, 0), blocks: plain() })), false)
})

// --- bug 3: the rescue must not be rate-limited ----------------------------

ok('the assessment is stateless: consecutive ticks all say swim', () => {
  // The throttle bug made the FIRST evaluation consume a token that the rescue
  // branch then needed. Nothing here may carry state between ticks.
  const bot = makeBot({ pos: new V(0, 50, 0), blocks: ocean(), oxygen: 0, health: 9 })
  for (let tick = 0; tick < 10; tick++) {
    const a = assessAir(bot)
    assert.equal(a.act, 'swim', `tick ${tick} stopped rescuing -- drowning damage lands ~1/s`)
  }
})

ok('assessing one bot never affects another', () => {
  const drowning = makeBot({ pos: new V(0, 50, 0), blocks: ocean(), oxygen: 0, health: 9 })
  const fine = makeBot({ blocks: plain(), oxygen: 300, health: 20 })
  assessAir(drowning)
  assert.equal(assessAir(fine).losing, false)
  assert.equal(assessAir(drowning).act, 'swim', 'still rescuing after an unrelated call')
})

// --- boundaries ------------------------------------------------------------

ok('the low-oxygen threshold is a boundary, not a cliff', () => {
  const at = ox => assessAir(makeBot({
    pos: new V(0, 50, 0), blocks: ocean(), oxygen: ox, health: 10,
  })).losing
  assert.equal(at(5), false, 'above the threshold is not an emergency')
  assert.equal(at(4), true, 'at the threshold it is')
  assert.equal(at(0), true)
  assert.equal(at(-17), true, 'Air goes NEGATIVE while drowning -- observed live at -17')
})

ok('a missing oxygen field is not an emergency', () => {
  const bot = makeBot({ blocks: ocean(), health: 20 })
  bot.oxygenLevel = null
  assert.equal(assessAir(bot).losing, false, 'absent data must not manufacture a rescue')
})

console.log(`\n${n} passed`)
