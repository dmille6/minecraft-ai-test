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
import { waterPosture, airConsequenceEvidence } from '../src/reflex.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const WATER = { name: 'water', boundingBox: 'empty' }
const AIR = { name: 'air', boundingBox: 'empty' }

// --- defect 1: never release into idle -------------------------------------

t('an afloat bot nobody is steering keeps its head up', () => {
  assert.equal(waterPosture({ owned: false, ashore: false, feet: WATER, head: AIR }),
    'float',
    'this is the exact state 15 of 23 drowning deaths were in: afloat, unowned, silent')
})

// --- KELP IS NOT A REASON TO TREAD WATER -----------------------------------
//
// The previous version asked one wide question -- "is this wet" -- and counted
// kelp and seagrass as water. It then pressed `jump` and nothing else. In kelp
// the older code did nothing at all; the wide version made the bot tread water
// in place, which is the measured killer: 4 drownings in 26 bot-hours against 8
// in 365 control bot-hours, p ~ 0.003, rolled back 2026-08-29.
//
// The two questions are now permanently separate. Being IN water is narrow.
// Being able to BREATHE is broad.

t('standing in kelp is not standing in water', () => {
  const KELP = { name: 'kelp_plant', boundingBox: 'empty' }
  assert.equal(waterPosture({ owned: false, ashore: false, feet: KELP, head: AIR }), false,
    'kelp at the feet must not trigger a water posture — that is what drowned bots')
})

t('but kelp at the HEAD still means it cannot breathe', () => {
  const KELP = { name: 'kelp_plant', boundingBox: 'empty' }
  assert.notEqual(waterPosture({ owned: false, ashore: false, feet: WATER, head: KELP,
                                 route: { dir: 'up' } }), 'float',
    'a head inside kelp is underwater, however empty the block looks')
})

// --- every posture carries a direction -------------------------------------

t('a submerged bot with air above RISES, and up is the direction', () => {
  assert.equal(waterPosture({ owned: false, ashore: false, feet: WATER, head: WATER,
                              route: { dir: 'up' } }), 'surface')
})

t('a submerged bot whose only air is sideways is steered to it', () => {
  assert.equal(waterPosture({ owned: false, ashore: false, feet: WATER, head: WATER,
                              route: { dir: 'out' } }), 'surface_out',
    'jumping cannot reach a sideways pocket; this posture must also steer')
})

t('no reachable air is SAID, not mimed', () => {
  assert.equal(waterPosture({ owned: false, ashore: false, feet: WATER, head: WATER,
                              route: null }), 'no_air_route')
})

t('the route scan is not paid for by a bot that is already afloat', () => {
  let scans = 0
  const r = waterPosture({ owned: false, ashore: false, feet: WATER, head: AIR,
                           route: () => { scans++; return { dir: 'up' } } })
  assert.equal(r, 'float')
  assert.equal(scans, 0, 'head already in air: nothing to decide, nothing to scan')
})

t('a bot on land is left alone', () => {
  assert.equal(waterPosture({ owned: false, ashore: true, feet: AIR, head: AIR }), false)
  assert.equal(waterPosture({ owned: false, ashore: false, feet: AIR, head: AIR }), false,
    'not in water: holding jump would make it bunny-hop across the map')
})

t('IT NEVER TOUCHES A BOT THAT IS TRAVELLING', () => {
  // The directive: water is terrain and swimming is a mode of travel. A bot
  // crossing a river on purpose owns its own body, and this must not cancel the
  // journey — that is how 231 crossings became 11.
  assert.equal(waterPosture({ owned: true, ashore: false, feet: WATER, head: WATER }), false)
})

t('every non-false answer is a named posture the caller can log', () => {
  const STATES = new Set(['float', 'surface', 'surface_out', 'no_air_route'])
  for (const head of [AIR, WATER]) {
    for (const route of [{ dir: 'up' }, { dir: 'out' }, null]) {
      const r = waterPosture({ owned: false, ashore: false, feet: WATER, head, route })
      assert.ok(STATES.has(r), `returned ${JSON.stringify(r)}, not a named posture`)
    }
  }
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

t('the reflex loop actually PASSES the head block and the route', () => {
  // THE SAME SEAM, AND THE SAME REASON. Every behaviour test above hands
  // `head` in by hand, so all of them still pass if the call site keeps the old
  // feet-only invocation -- in which case `head` defaults to null, every wet
  // bot reads as `surface_first`, and the 32% is renamed instead of fixed.
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const call = src.slice(src.indexOf('waterPosture({', src.indexOf('const holdState =')))
  const args = call.slice(0, call.indexOf('})'))
  assert.ok(/\bhead:/.test(args),
    'waterPosture is called without head — a submerged bot reads as afloat')
  assert.ok(/\broute:/.test(args),
    'waterPosture is called without route — blocked_surface can never be reported')
  assert.ok(/breathableRoute\(bot\)/.test(args),
    'the route must come from breathableRoute, or every submerged bot reads as blocked')
})

t('the ended event is split by how the episode STARTED', () => {
  // A single `..._ended` kind puts floats and submerged recoveries in one
  // bucket, and no count-based query can tell them apart.
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  assert.ok(/water_\$\{startedAs\}_ended/.test(src),
    'every posture ends as one kind regardless of how it began')
  // The OLD series must not be reused. It graded episodes by an air dip and by
  // a predicate that counted kelp as water; continuing the name would splice
  // two different definitions into one line on a dashboard.
  assert.ok(!/'water_surface_hold_ended'/.test(src),
    'the retired hold series must not be revived under its old name')
})

t('the reflex never issues jump as the whole action when the head is under', () => {
  // Treading water is jump without a direction, and it is the measured killer.
  // `float` is the one posture where up is all that is wanted, because the head
  // is already out. Every other posture must set a direction too.
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const block = src.slice(src.indexOf('if (holdState) {'))
  const body = block.slice(0, block.indexOf('if (!holdStartedAt)'))
  assert.ok(/setControlState\('forward', true\)/.test(body),
    'no posture steers: this is the treading-water bug being rebuilt')
  assert.ok(/lookAt/.test(body), 'steering without aiming is not steering')
})

t('THE ROLLBACK GUARD: an UNOWNED bot still gets the full rescue', () => {
  // Canary 4a1dfcb demoted the reflex for every bot, not just travelling ones.
  // 5 deaths in 5.7 bot-hours, 0.526 drownings/bot-h against 0.070 for
  // controls — 7.5x, p = 0.0079 — because 193 float + 156 surface episodes had
  // nobody steering while only 17 crossings did. The rescue was the only thing
  // coming for them.
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  const site = src.slice(src.indexOf('const owned = !!bot.pathfinder?.goal'))
  const guard = site.slice(0, site.indexOf('air.act') + 40)
  assert.ok(/\(emergency \|\| !owned\)/.test(guard),
    'the seizure is gated on emergency ALONE again — an unowned bot in water ' +
    'now has nothing coming for it, which is what killed five bots')
  assert.ok(/if \(!emergency && owned\)/.test(src),
    'the stand-down must require a travel owner, not just the absence of an emergency')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
