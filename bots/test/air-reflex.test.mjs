// THE ONLY WATER REFLEX IS "GET AIR", AND THESE TESTS EXIST TO STOP IT
// BECOMING "GET OUT OF THE WATER" AGAIN.
//
// Measured over 12 hours on 80 bots, 151,895 water events: the old reflex made
// 26,795 attempts to reach SHORE against 23,877 to reach AIR, succeeded 1,585
// times, and the bot came straight back into the water 12,506 times — an 8:1
// revolving door. "Get air" and "get out of the water" were treated as one
// goal. Air is a metre straight up and nearly always available; shore is a
// navigation problem that mostly fails.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { airAction, nearestAir, MAX_LATERAL, RELEASE_MS, ENTER_AIR_SECONDS }
  from '../src/air-reflex.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

// --- being in water is not an event ----------------------------------------

t('AN IDLE BOT IN WATER WITH AIR IS LEFT ALONE', () => {
  // The owner's model: swimming is a way of moving, not a condition. Idle in
  // water is no more remarkable than idle in a field.
  assert.equal(airAction({ headUnder: true, airSeconds: 14 }), null)
  assert.equal(airAction({ headUnder: false, airSeconds: 15 }), null)
})

t('being WET is never the trigger — only the head being under, with low air', () => {
  assert.equal(airAction({ headUnder: false, airSeconds: 0 }), null,
    'head in air is not an emergency however low the clock reads')
})

// --- the reflex itself -----------------------------------------------------

t('low air with the head under makes the bot RISE', () => {
  assert.deepEqual(airAction({ headUnder: true, airSeconds: ENTER_AIR_SECONDS - 1 }),
    { act: 'rise' })
})

t('falling health while submerged acts immediately, whatever the clock says', () => {
  // Damage is ground truth: it means the air model is already wrong.
  assert.deepEqual(airAction({ headUnder: true, airSeconds: 15, healthFalling: true }),
    { act: 'rise' })
})

t('it does NOT let go the instant the head breaks the surface', () => {
  // A bot bobbing at the surface breaks the plane for a moment and goes back
  // under. Releasing there hands the body back mid-drown.
  assert.deepEqual(airAction({ active: true, headUnder: false, headOutMs: 200 }),
    { act: 'rise' })
  assert.deepEqual(airAction({ active: true, headUnder: false, headOutMs: RELEASE_MS }),
    { act: 'release' })
})

t('it keeps rising while submerged even after air recovers', () => {
  // Half-way up with the clock refilled is not a reason to stop.
  assert.deepEqual(airAction({ active: true, headUnder: true, airSeconds: 15 }),
    { act: 'rise' })
})

// --- blocked ascent: sideways to AIR, and nothing else ---------------------

t('blocked ascent moves toward AIR when it is within reach', () => {
  const r = airAction({ headUnder: true, airSeconds: 2, stalledMs: 2000,
                        airNear: { dx: 2, dz: 0, dist: 2 } })
  assert.deepEqual(r, { act: 'rise_toward', dx: 2, dz: 0 })
})

t('THE ANTI-REGROWTH BOUND: air further than 3 blocks is not chased', () => {
  // Beyond a lunge it is navigation, and navigation is how this became shore
  // rescue. It keeps rising instead — which may fail, and failing honestly is
  // the point.
  const r = airAction({ headUnder: true, airSeconds: 2, stalledMs: 2000,
                        airNear: { dx: 9, dz: 0, dist: 9 } })
  assert.deepEqual(r, { act: 'rise' })
})

t('it does not go sideways until ascent has actually stalled', () => {
  const r = airAction({ headUnder: true, airSeconds: 2, stalledMs: 0,
                        airNear: { dx: 1, dz: 0, dist: 1 } })
  assert.deepEqual(r, { act: 'rise' }, 'sideways is a fallback, not a first move')
})

t('with no air anywhere in reach it still rises rather than inventing a plan', () => {
  assert.deepEqual(airAction({ headUnder: true, airSeconds: 1, stalledMs: 9000,
                              airNear: null }), { act: 'rise' })
})

// --- the search is bounded and prefers the nearest ring --------------------

t('nearestAir takes the closest opening and stops looking', () => {
  const near = nearestAir((dx, dz) => Math.abs(dx) + Math.abs(dz) >= 2)
  assert.equal(near.dist, 2)
})

t('nearestAir gives up past the bound rather than widening', () => {
  assert.equal(nearestAir(() => false), null)
  assert.equal(nearestAir((dx) => dx === 9), null, 'a distant opening is not a target')
})

// --- the guardrail, asserted on the source itself --------------------------

t('THE MODULE MUST NOT KNOW WHAT LAND IS', () => {
  // The single check most likely to catch this regrowing. If a future edit
  // scores candidates by anything except "can I breathe there, and how far",
  // it has become the thing that was deleted.
  const src = readFileSync(new URL('../src/air-reflex.mjs', import.meta.url), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  for (const banned of ['shore', 'land', 'ashore', 'pathfinder', 'setGoal',
                        'worldFacts', 'known', 'escape', 'rescue']) {
    assert.ok(!new RegExp(`\\b${banned}\\b`, 'i').test(code),
      `air-reflex.mjs mentions "${banned}" in code — the reflex is becoming a ` +
      'navigation policy again')
  }
})

t('the lateral bound is small enough to be a lunge, not a journey', () => {
  assert.ok(MAX_LATERAL <= 3, `MAX_LATERAL is ${MAX_LATERAL}; beyond 3 this is navigation`)
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
