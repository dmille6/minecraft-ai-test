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

// A drowning bot is in water. The critical-air override now REQUIRES the world
// to agree -- in water, head in water, head sealed, or health dropping -- because
// a bare "oxygen <= 25%" above the losing-check would seize a bot standing in dry
// air with a stale reading and never release it (breathingAgain reads flat-low as
// "not breathing"). This project already logs oxygen_reading_suspect, so stale
// readings are known to happen.
const samples = (...v) => ({ oxygenSamples: v, previousHealth: null, airMax: 20,
                             head: { name: 'water', boundingBox: 'empty' } })
const wet = (o) => ({ health: 20, oxygenLevel: o, entity: { isInWater: true } })

t('a single up-tick no longer disables the rescue at critical air', () => {
  // The cycling trace: sank, surfaced, sank again. Every cycle writes an up-tick.
  const bot = wet(4)                                  // 20% of a 20 tank, in water
  assert.equal(airConsequenceEvidence(bot, { losing: true }, samples(10, 12, 8, 6, 4)), true,
    'oxygen at 20% and falling, and the gate still refused — that is the death trace')
})

t('a wading bot is still not rescued', () => {
  // The noise-rejection this guard exists for MUST survive the fix, or every
  // paddle through a stream seizes the body.
  const bot = wet(19)
  assert.equal(airConsequenceEvidence(bot, { losing: true }, samples(20, 19, 20, 19)), false,
    'a bot at 95% air was rescued — the critical override is firing far too high')
})

t('the critical threshold is scaled to the SERVER, not to a constant', () => {
  // 1.21.8 reports a ~400-tick air scale where the default constant assumes 20.
  // A threshold computed against the wrong scale never fires at all.
  const bot = wet(80)                                 // 20% of a 400 tank
  assert.equal(airConsequenceEvidence(bot, { losing: true },
    { oxygenSamples: [200, 220, 150, 80], previousHealth: null, airMax: 400,
      head: { name: 'water', boundingBox: 'empty' } }), true)
  // and the same reading on a 20-scale server is a FULL tank, so it must not fire
  assert.equal(airConsequenceEvidence(wet(80), { losing: true },
    { oxygenSamples: [80, 90, 80], previousHealth: null, airMax: 20,
      head: { name: 'water', boundingBox: 'empty' } }), false)
})

t('falling health still acts, regardless of air', () => {
  assert.equal(airConsequenceEvidence({ health: 12, oxygenLevel: 20 }, { losing: true },
    { oxygenSamples: [20, 20], previousHealth: 14, airMax: 20 }), true)
})

t('THE FLOOR CASE: pinned-low oxygen in water is rescued even when not "losing"', () => {
  // Two bots sat entombed for five hours logging "air fell to 6% (20/320);
  // rescuing=false" while nothing fired, because assessAir reports losing=false
  // at the FLOOR exactly as it does when wading, and the old code returned false
  // on that line before any other evidence was considered.
  assert.equal(airConsequenceEvidence(wet(20), { losing: false },
    { oxygenSamples: [20, 20, 20], previousHealth: null, airMax: 320,
      head: { name: 'water', boundingBox: 'empty' } }), true,
    'a bot at 6% air in water was refused a rescue — that is the five-hour trace')
})

t('but critical air in DRY conditions is NOT an emergency', () => {
  // The inverse, and the reason the floor case is guarded rather than hoisted
  // bare: a stale reading on a bot standing in air must not seize the body,
  // because breathingAgain() reads flat-low as "not breathing" and would never
  // let go.
  assert.equal(airConsequenceEvidence(
    { health: 20, oxygenLevel: 2, entity: { isInWater: false } }, { losing: false },
    { oxygenSamples: [2, 2, 2], previousHealth: null, airMax: 20,
      head: { name: 'air', boundingBox: 'empty' } }), false,
    'a dry bot with a stale low reading was seized — it would never be released')
})

t('isInWater ALONE is enough, because the head block can lie', () => {
  // THE STALE-CHUNK CASE, which this project has already been bitten by: the
  // client reported AIR at head height while the server was drowning the bot.
  // test/helpers/microworld.mjs still carries an `oceanWithStaleChunks` fixture
  // built from that incident.
  //
  // So physics (entity.isInWater, set by prismarine-physics from the server's
  // own collision result) must be sufficient on its own. A mutation removing
  // that clause survived every other test here, because they all supplied a
  // water head block as well.
  assert.equal(airConsequenceEvidence(
    { health: 20, oxygenLevel: 2, entity: { isInWater: true } }, { losing: false },
    { oxygenSamples: [2, 2], previousHealth: null, airMax: 20,
      head: { name: 'air', boundingBox: 'empty' } }), true,
    'physics said in-water and the head block said air; the head block won')
})

t('a sealed head counts as evidence even out of water', () => {
  // Entombed in stone with air draining is drowning-shaped even though
  // isInWater is false and the head block is not water.
  assert.equal(airConsequenceEvidence(
    { health: 20, oxygenLevel: 2, entity: { isInWater: false } }, { losing: false },
    { oxygenSamples: [2, 2], previousHealth: null, airMax: 20,
      head: { name: 'stone', boundingBox: 'block' } }), true)
})

t('a bot that is not losing air is never rescued', () => {
  // NOTE: with the floor case above, `losing:false` alone no longer short-circuits
  // for a bot that is critically low AND in water. What must still be true is
  // that a bot with plenty of air and losing:false is left alone.
  assert.equal(airConsequenceEvidence(wet(18), { losing: false }, samples(19, 18)), false,
    'a bot with 90% air and not losing was seized')
})

// --- the wiring, which is where the last one hid -----------------------------

// The 'deliberately unwired' assertion that lived here has been DELETED, which
// is exactly what it instructed. The surface-hold is wired back because the
// ablation that removed it measured drowning deaths at 0.1263 per
// exposure-weighted bot-hour against 0.0361 with it -- P(4 deaths in 32 bot-h |
// hold-ON rate) = 0.030, so the data rejects "the hold made no difference".

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
