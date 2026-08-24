// THE SITUATION IS NOT THE SCALE.
//
// airMax tells the drowning reflex what "full air" means. It has now been wrong
// twice, in opposite directions, and both times the calibration was the bug
// rather than the thing being calibrated:
//
//   v1 ratcheted UP forever. One anomalous tick-scale reading pinned it at 300
//      on a build reporting bubbles, so the trigger became 120 against readings
//      of <=20 and the bot believed it was permanently suffocating.
//   v2 used max() over a 2-minute sliding window. A bot submerged longer than
//      the window has no high readings left in it, so airMax collapsed to the
//      most air it had seen WHILE DROWNING. Measured over 6h on 40 bots, every
//      single bot's airMax took several values -- 400, 320, 189, and 20, which
//      is v2's own floor. At airMax=20 a bot holding 20 of 400 units of air,
//      five percent, computes 100% and gets no rescue until it reaches 8.
//
// That is what 9,171 critical entries and 2,386 re-entries at a median of six
// seconds were made of. So the tests below are the two corpses, plus the third
// case neither version could express: not knowing yet.
import assert from 'node:assert'
import { calibrateAirMax, updateAirMax, assessAir } from '../src/reflex.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

/** A run of readings, marked breathing/drowning by whether they fall. */
const trace = (values) => {
  let prev = null
  return values.map(oxygen => {
    const rising = prev == null || oxygen >= prev
    prev = oxygen
    return { oxygen, rising }
  })
}

// --- v2's corpse: a long dive must not redefine full ------------------------

t('A LONG DIVE CANNOT LOWER THE SCALE', () => {
  // Sitting at 400 on land, then four minutes of draining air. Under the
  // sliding-window max this returns ~the best drowning reading; it must return
  // the land value or nothing at all, never a number invented underwater.
  const land = Array(20).fill(400)
  const dive = Array(480).fill(0).map((_, i) => Math.max(0, 400 - i))
  const got = calibrateAirMax(trace([...land, ...dive]))
  assert.equal(got, 400,
    `a bot underwater for four minutes calibrated full air as ${got}`)
})

t('an ENTIRELY submerged trace establishes nothing rather than something small', () => {
  // The 20-floor case: a bot that has been under since before the window began.
  // Answering 20 here is what suppressed the rescue on 3,233 occasions.
  const got = calibrateAirMax(trace([300, 280, 260, 240, 220, 200, 180, 20, 19, 18, 8, 4]))
  assert.ok(got == null || got >= 300,
    `a falling trace was allowed to define the scale as ${got}`)
})

t('a bot that is only ever drowning gets null, and null is the honest answer', () => {
  const got = calibrateAirMax([
    { oxygen: 40, rising: false }, { oxygen: 30, rising: false },
    { oxygen: 20, rising: false }, { oxygen: 10, rising: false },
  ])
  assert.equal(got, null, 'drowning readings were promoted to a scale')
})

// --- the monotonic rule ------------------------------------------------------

t('THE SCALE NEVER COMES BACK DOWN', () => {
  // A bot fifteen minutes in water, surfacing briefly to a hundred units. Those
  // are real breathing samples -- a surfacing counter rises -- so the
  // calibrator admits them and would happily call 100 the scale as the older
  // land readings age out of the window. 400 was measured on dry land and a
  // server does not change its air scale because a bot went for a swim.
  const shallow = [
    { oxygen: 100, rising: true }, { oxygen: 100, rising: true },
    { oxygen: 100, rising: true }, { oxygen: 99, rising: false },
  ]
  assert.equal(calibrateAirMax(shallow), 100, 'sanity: this is what it learns')
  assert.equal(updateAirMax(400, shallow), 400,
    'a brief surfacing at partial air redefined full air downward')
})

t('but it does rise when a genuinely higher scale appears', () => {
  const full = [
    { oxygen: 400, rising: true }, { oxygen: 400, rising: true },
    { oxygen: 400, rising: true },
  ]
  assert.equal(updateAirMax(20, full), 400, 'a real higher scale was ignored')
})

t('an unestablished scale stays unestablished rather than becoming a number', () => {
  assert.equal(updateAirMax(0, [{ oxygen: 400, rising: true }]), 0)
})

// --- v1's corpse: one anomaly must not pin it -------------------------------

t('ONE ANOMALOUS READING CANNOT PIN THE SCALE', () => {
  // The exact v1 failure: a build reporting bubbles, with a single stray
  // tick-scale value. Third-highest, so it takes three to move it.
  const s = trace([20, 20, 20, 20, 20, 20, 20, 20]).concat([{ oxygen: 300, rising: true }])
  assert.equal(calibrateAirMax(s), 20,
    'a single 300 redefined a 0-20 server and every bot suffocates permanently')
})

t('two anomalies still cannot', () => {
  const s = trace([20, 20, 20, 20, 20, 20])
    .concat([{ oxygen: 300, rising: true }, { oxygen: 299, rising: true }])
  assert.equal(calibrateAirMax(s), 20, 'two outliers moved the scale')
})

t('but a real scale, seen repeatedly, IS learned', () => {
  assert.equal(calibrateAirMax(trace([400, 400, 400, 400, 400])), 400)
  assert.equal(calibrateAirMax(trace([20, 20, 20, 20, 20])), 20)
})

t('too little evidence is null, not a guess', () => {
  assert.equal(calibrateAirMax(trace([400, 400])), null)
  assert.equal(calibrateAirMax([]), null)
})

// --- the third case: not knowing yet ----------------------------------------

const botAt = (ox, { health = 20, inWater = true } = {}) => ({
  oxygenLevel: ox,
  health,
  entity: { position: { offset: () => ({}) }, isInWater: inWater },
  blockAt: () => ({ name: inWater ? 'water' : 'air', boundingBox: 'empty' }),
})

t('AN UNKNOWN SCALE STILL RESCUES A DRAINING BOT', () => {
  // airMax=0 used to multiply out to a threshold of 4, which on a 0-400 server
  // means the rescue fires at one percent of air. The trend has to carry it.
  const air = assessAir(botAt(180), { airMax: 0, prevOxygen: 260 })
  assert.equal(air.losing, true,
    'a bot losing 80 units of air with no established scale was left alone')
})

t('an unknown scale does NOT rescue a bot that is merely wading', () => {
  // The mirror: wading holds oxygen pinned at full. Firing here is the
  // 2,278-escapes-per-hour bug that cost goto its success rate.
  const air = assessAir(botAt(400), { airMax: 0, prevOxygen: 400 })
  assert.equal(air.losing, false, 'a wading bot was seized on an unknown scale')
})

t('THE FIVE PERCENT CASE: 20 of 400 is an emergency, not full air', () => {
  // The release detail logged 184 times: "released after 20s still in water
  // (oxygen 20, health 20)". Under airMax=20 this computed as 100%.
  const wrong = assessAir(botAt(20), { airMax: 20, prevOxygen: 20 })
  assert.equal(wrong.losing, false,
    'sanity: this is what the collapsed scale used to conclude')
  const right = assessAir(botAt(20), { airMax: 400, prevOxygen: 200 })
  assert.equal(right.losing, true,
    'with the true scale, a bot at 5% air must be losing')
})

t('a known scale behaves exactly as before', () => {
  assert.equal(assessAir(botAt(300), { airMax: 400, prevOxygen: 400 }).losing, false,
    '75% air is not an emergency')
  assert.equal(assessAir(botAt(100), { airMax: 400, prevOxygen: 300 }).losing, true,
    '25% air and falling is')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
