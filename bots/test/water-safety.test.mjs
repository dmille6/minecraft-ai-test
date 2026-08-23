// THE INTERVAL WHERE NOBODY OWNS SURVIVAL.
//
// Twenty-three bots drowned in four hours -- 0.143 deaths per bot-hour against a
// baseline of 0.053 -- while the escape-rate metric I was optimising improved.
// The pre-death traces say what happened, and it is not subtle:
//
//   -2.6s  _drowning_surfaced_stranded  released after 3s still in water
//                                       (oxygen 239, health 20)
//   +0.0s  _death                       drowned; idle at the moment of death
//
// Fifteen of the twenty-three end with `_reflex_low_health` followed by roughly
// twenty-four seconds of TOTAL SILENCE, then death. Those bots were not fighting
// to get out. Nobody was steering them at all.
//
// Two separate defects, and fixing either alone still kills bots:
//
//  1. The release cleared every control state and handed the body to no one.
//     The pinning it replaced was wasteful -- 20s of paralysis per cycle -- but
//     holding `jump` was ALSO life support, and I mistook the cost for the whole
//     effect.
//
//  2. airConsequenceEvidence refuses to act on ANY upward tick in the oxygen
//     window. That is correct noise-rejection for a bot wading through a stream
//     and lethal for one cycling surface/sink, because every cycle writes an
//     up-tick. Refusals ran at 33.9% of drowning detections, and
//     `_air_drowning_observed` -- the kind logged when the gate says no --
//     appears 0.1s before a death at "oxygen 20, head block water, health 1.33".
//
// These are behaviour tests on the emitted decision, deliberately not source
// greps. Source greps are what let bot.waterMovements ship as dead code: they
// asserted the profile was configured correctly, and nothing asserted that any
// consumer used it.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { shouldHoldSurface, airConsequenceEvidence } from '../src/reflex.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const WATER = { name: 'water', boundingBox: 'empty' }
const AIR = { name: 'air', boundingBox: 'empty' }

// --- defect 1: never release into idle -------------------------------------

t('an afloat bot nobody is steering gets its head held up', () => {
  assert.equal(shouldHoldSurface({ rescuing: false, swimming: false, ashore: false, feet: WATER }), true,
    'this is the exact state 15 of 23 drowning deaths were in: afloat, unowned, silent')
})

t('a bot on land is left alone', () => {
  assert.equal(shouldHoldSurface({ rescuing: false, swimming: false, ashore: true, feet: AIR }), false)
  assert.equal(shouldHoldSurface({ rescuing: false, swimming: false, ashore: false, feet: AIR }), false,
    'not in water: holding jump would make it bunny-hop across the map')
})

t('it never fights a controller that already owns the body', () => {
  // Ownership, not safety. A rescue and a deliberate crossing both steer jump
  // themselves, and a second writer is the multi-writer bug the movement ratchet
  // exists to prevent.
  assert.equal(shouldHoldSurface({ rescuing: true, swimming: false, ashore: false, feet: WATER }), false)
  assert.equal(shouldHoldSurface({ rescuing: false, swimming: true, ashore: false, feet: WATER }), false)
})

// --- defect 2: nearly-out-of-air outranks the trend test --------------------

const samples = (...v) => ({ oxygenSamples: v, previousHealth: null, airMax: 20 })

t('a single up-tick no longer disables the rescue at critical air', () => {
  // The cycling trace: sank, surfaced, sank again. Every cycle writes an up-tick.
  const bot = { health: 20, oxygenLevel: 4 }          // 20% of a 20 tank
  assert.equal(airConsequenceEvidence(bot, { losing: true }, samples(10, 12, 8, 6, 4)), true,
    'oxygen at 20% and falling, and the gate still refused — that is the death trace')
})

t('a wading bot is still not rescued', () => {
  // The noise-rejection this guard exists for MUST survive the fix, or every
  // paddle through a stream seizes the body.
  const bot = { health: 20, oxygenLevel: 19 }
  assert.equal(airConsequenceEvidence(bot, { losing: true }, samples(20, 19, 20, 19)), false,
    'a bot at 95% air was rescued — the critical override is firing far too high')
})

t('the critical threshold is scaled to the SERVER, not to a constant', () => {
  // 1.21.8 reports a ~400-tick air scale where the default constant assumes 20.
  // A threshold computed against the wrong scale never fires at all.
  const bot = { health: 20, oxygenLevel: 80 }         // 20% of a 400 tank
  assert.equal(airConsequenceEvidence(bot, { losing: true },
    { oxygenSamples: [200, 220, 150, 80], previousHealth: null, airMax: 400 }), true)
  // and the same reading on a 20-scale server is a FULL tank, so it must not fire
  assert.equal(airConsequenceEvidence({ health: 20, oxygenLevel: 80 }, { losing: true },
    { oxygenSamples: [80, 90, 80], previousHealth: null, airMax: 20 }), false)
})

t('falling health still acts, regardless of air', () => {
  assert.equal(airConsequenceEvidence({ health: 12, oxygenLevel: 20 }, { losing: true },
    { oxygenSamples: [20, 20], previousHealth: 14, airMax: 20 }), true)
})

t('a bot that is not losing air is never rescued', () => {
  assert.equal(airConsequenceEvidence({ health: 20, oxygenLevel: 1 }, { losing: false }, samples(5, 3, 1)), false,
    'losing:false must short-circuit, or the reflex fires on a bot standing in air')
})

// --- the wiring, which is where the last one hid -----------------------------

t('shouldHoldSurface is DELIBERATELY unwired right now', () => {
  // The surface-hold was reverted so the same G1/G2/G3 gates could be re-run
  // without it, because three attempts to write an efficacy criterion all
  // classified the hold HANDING OFF to a rescue as the hold failing.
  //
  // The predicate is kept, and still tested above, because it comes back if
  // deaths climb toward the 0.134/bot-h that preceded it. But a tested function
  // with no caller is exactly how bot.waterMovements shipped as dead code, so
  // the disconnection is asserted rather than left to be discovered.
  //
  // WIRING IT BACK? Delete this test. That is the point of it.
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  // Exclude the declaration itself: `export function shouldHoldSurface({ ... })`
  // matches a naive call regex, and the first version of this test failed on it.
  const calls = (src.match(/shouldHoldSurface\(\{/g) || []).length -
                (src.match(/function shouldHoldSurface\(\{/g) || []).length
  assert.equal(calls, 0,
    'shouldHoldSurface has a caller again — either that is the intended restore ' +
    '(delete this test and re-register G4) or it was wired back by accident')
})

t('the reflex loop actually PASSES the learned air scale', () => {
  // A WIRING ASSERTION, and labelled as one rather than dressed up as behaviour.
  //
  // Every test above passes airMax explicitly, so all of them still pass if the
  // call site quietly stops supplying it -- and then the threshold is computed
  // against the default 20 on a server reporting ~400, where 25% is 5 and the
  // override never fires. A mutation removing `airMax,` from the caller was NOT
  // caught by any behaviour test here.
  //
  // This is the bot.waterMovements defect again: a correctly-configured thing
  // that nothing consumes. The behaviour tests cannot see the seam, so the seam
  // gets its own check.
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const call = src.slice(src.indexOf('const mayAct = airConsequenceEvidence('))
  const args = call.slice(0, call.indexOf('})'))
  assert.ok(/\bairMax\b/.test(args),
    'airConsequenceEvidence is called without airMax — on a 400-tick server the ' +
    'critical-oxygen override silently never fires')
  assert.ok(/previousHealth/.test(args), 'previousHealth dropped from the call')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
