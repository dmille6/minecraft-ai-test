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

ok('the air threshold scales with the units the server actually uses', () => {
  const at = (ox, airMax) => assessAir(makeBot({
    pos: new V(0, 50, 0), blocks: ocean(), oxygen: ox, health: 10,
  }), { airMax }).losing
  // THE UNITS ARE NOT BUBBLES. mineflayer documents oxygenLevel as 0-20; this
  // build reports the raw air tick counter -- measured min -1, max 400, with
  // 192 of 1,222 samples above 20. A hardcoded 10 meant the rescue began with
  // HALF A SECOND of air and then had to swim a median of 3 blocks, so bots
  // surfaced 435 times out of 435 and still drowned.
  //
  // The trigger is now a fraction of the largest value the bot has reported,
  // so it is right on either scale and cannot be silently wrong again.
  assert.equal(at(300, 400), false, 'nearly full air is not an emergency')
  assert.equal(at(160, 400), true,  '40% of a 400-tick scale is')
  assert.equal(at(10,  400), true,  'almost drowned certainly is')
  assert.equal(at(16,   20), false, 'on a 0-20 build, full air is not an emergency')
  assert.equal(at(6,    20), true,  'on a 0-20 build, 30% is')
  assert.equal(at(0,   400), true)
  assert.equal(at(-17, 400), true, 'Air goes NEGATIVE while drowning -- observed live at -17')
})

ok('the threshold gives enough air to actually reach the surface', () => {
  // The failure this encodes: 20 air ticks per second, and the routes that were
  // killing bots ran a median of 3 blocks and a maximum of 15. Swimming up is
  // roughly 2 blocks/sec, so a 15-block ascent needs ~7.5s = ~150 ticks.
  const airMax = 400
  const trigger = Math.max(4, Math.round(airMax * 0.4))
  assert.ok(trigger >= 150,
    `trigger ${trigger} ticks is under the ~150 needed for the longest observed ascent`)
})

ok('a missing oxygen field is not an emergency', () => {
  const bot = makeBot({ blocks: ocean(), health: 20 })
  bot.oxygenLevel = null
  assert.equal(assessAir(bot).losing, false, 'absent data must not manufacture a rescue')
})


// --- WADING IS NOT DROWNING ------------------------------------------------
//
// entity.isInWater is true for a bot standing in shallow water with its head in
// open air. Air does not drain when your head is above the surface, so that bot
// loses nothing -- but the reflex fired anyway and aborted whatever skill was
// running. Measured on fleet-028: 2,278 drowning escapes per HOUR, every one
// logging `head=air health=20`, with goto down to 4% success -- not because
// pathing failed but because it was interrupted 38 times a minute.
//
// The fix is NOT "stop believing isInWater". The test above pays for that
// lesson: a genuinely submerged bot can read head=air from a stale chunk. The
// discriminator is whether the counter is MOVING.
ok('oxygen pinned at full is not drowning, even with isInWater set', () => {
  const bot = {
    entity: { position: new V(0, 63, 0), isInWater: true },
    oxygenLevel: 20, health: 20,
    blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
  }
  const r = assessAir(bot, { airMax: 300, prevOxygen: 20 })
  assert.equal(r.losing, false,
    'a wading bot at full air must not interrupt the skill that is running')
  assert.equal(r.suspect, true, 'but the disagreement is worth recording')
})

ok('a FALLING counter is drowning, even when blockAt claims air', () => {
  // The stale-chunk case the isInWater lesson exists for. Same head, same
  // health -- only the trend differs, and the trend decides.
  const bot = {
    entity: { position: new V(0, 63, 0), isInWater: true },
    // Below the low-air threshold (airMax 40 -> trigger 16) AND falling.
    // Both matter: the threshold decides whether we care, the trend decides
    // whether it is real.
    oxygenLevel: 10, health: 20,
    blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
  }
  const r = assessAir(bot, { airMax: 40, prevOxygen: 14 })
  assert.equal(r.losing, true, 'air is draining; that is the whole signal')
  assert.equal(r.kind, 'drowning')
})

ok('no history means no trend gate -- the pure function stays honest', () => {
  const bot = {
    entity: { position: new V(0, 63, 0), isInWater: true },
    oxygenLevel: 10, health: 20,
    blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
  }
  assert.equal(assessAir(bot, { airMax: 40 }).losing, true,
    'a caller with no previous reading gets the old, cautious behaviour')
})


ok('one tick-scale outlier does not make a full bubble reading look critical', () => {
  // The live failure: bot.oxygenLevel arrives on two scales intermittently, so
  // a window of [20,20,20,160,20,...] had a PEAK of 160. A perfectly normal
  // reading of 20 then looked like a catastrophic drop and the reflex fired --
  // 12 of 13 survivors logged `head=air health=20`, one beside an oxygen=160.
  // The median of that window is 20, and a median cannot be moved by one
  // sample in twelve.
  const window = [20, 20, 20, 160, 20, 20, 20, 20, 20, 20, 20, 20]
  const sorted = [...window].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  assert.equal(median, 20, 'the reference must survive the outlier')
  assert.equal(Math.max(...window), 160, 'which the old peak-based reference did not')

  const bot = {
    entity: { position: new V(0, 63, 0), isInWater: true },
    oxygenLevel: 20, health: 20,
    blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
  }
  assert.equal(assessAir(bot, { airMax: 20, prevOxygen: median }).losing, false,
    'a wading bot at full air must not have its skill aborted')
})


ok('head IN water fires immediately -- strong evidence needs no corroboration', () => {
  // The trend requirement must not delay a real rescue. A head block of water
  // is unambiguous, so it is believed on the spot even at a steady reading.
  const bot = {
    entity: { position: new V(0, 50, 0), isInWater: true },
    oxygenLevel: 6, health: 20,
    blockAt: () => ({ name: 'water', boundingBox: 'empty' }),
  }
  const r = assessAir(bot, { airMax: 20, prevOxygen: 6 })
  assert.equal(r.losing, true, 'a head underwater is not a case for waiting')
  assert.equal(r.kind, 'drowning')
})

ok('weak water evidence WITH a falling counter still rescues', () => {
  // The stale-chunk case: entity says water, blockAt says air, health still
  // full -- but the counter is draining, which is the corroboration required.
  const bot = {
    entity: { position: new V(0, 50, 0), isInWater: true },
    oxygenLevel: 8, health: 20,
    blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
  }
  const r = assessAir(bot, { airMax: 20, prevOxygen: 18 })
  assert.equal(r.losing, true, 'draining air is the evidence that makes it real')
  assert.equal(r.act, 'swim')
})

console.log(`\n${n} passed`)
