// THE RESCUE PURSUED AIR AND WAS GRADED ON LAND.
//
// After the release telemetry was made honest, the fleet reported 2,113
// `drowning_released_timeout` against 166 real escapes -- 91% of water rescues
// never reached land. The timeouts were not bots in danger:
//
//   Hive02  y=62.4  released after 21s still in water (oxygen 400, health 20)
//   Solo02  y=54.0  released after 20s still in water (oxygen 307, health 20)
//   Hive02  y=62.2  released after 20s still in water (oxygen 400, health 20)
//
// Oxygen 399-400 out of ~400, full health, floating at a water surface. Safe,
// wet, and holding the body of a rescue that could not end -- roughly 11.7
// fleet-hours of it, interrupting every travel skill attempted meanwhile.
//
// The cause is three things that only bite together: breathableRoute()
// correctly returns {dir:'up'} for anything under a surface (drowning-cave
// asserts this on purpose -- in a flooded cave air IS the exit); the steering
// set forward=FALSE for every non-'out' route; and the release required
// ashore(). So the escape aimed at the surface it was already touching, and
// was released only on ground it never swam toward.
//
// The fix adds a SECOND PHASE rather than changing the first: while still
// losing air, reach air; once breathing but not ashore, reach land.
import assert from 'node:assert'
import { shoreRoute, drowningControls, breathableRoute } from '../src/reflex.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}

const V = (x, y, z) => ({ x, y, z, offset: (a, b, c) => V(x + a, y + b, z + c) })
const AIR = { name: 'air', boundingBox: 'empty' }
const WATER = { name: 'water', boundingBox: 'empty' }
const DIRT = { name: 'dirt', boundingBox: 'block' }
const KELP = { name: 'kelp_plant', boundingBox: 'empty' }

/** world(fn) -> a bot at 0,62,0 whose blockAt is fn(x,y,z). */
const world = (fn) => ({ entity: { position: V(0, 62, 0), onGround: false },
                         blockAt: (p) => fn(p.x, p.y, p.z) })

// A lake: water below y=63, air above, with a dirt bank starting at x >= 5.
const lakeWithBank = world((x, y, z) => {
  if (x >= 5) return y <= 62 ? DIRT : AIR          // the bank
  return y <= 62 ? WATER : AIR                      // open water
})

// Water everywhere within scan range, no land at all.
const openOcean = world((x, y) => (y <= 62 ? WATER : AIR))

t('a bank within reach is found', () => {
  const r = shoreRoute(lakeWithBank)
  assert.equal(r.dir, 'shore', 'a dirt bank five blocks away must be reachable')
  assert.ok(r.target.x >= 5, `expected the bank, got x=${r.target?.x}`)
  assert.ok(r.dist <= 8, `should pick a near candidate, got ${r.dist}`)
})

t('open ocean honestly reports no shore', () => {
  // This must NOT invent a target. Open water is a failed rescue and the 20s
  // ceiling is the correct outcome.
  assert.equal(shoreRoute(openOcean).dir, null)
})

t('kelp and bubble columns are not shore', () => {
  // Same ground test as ashore(); if these disagree the bot swims to a place
  // that does not release it -- the original bug with new coordinates.
  const kelpy = world((x, y) => (y <= 62 ? (x >= 5 ? KELP : WATER) : AIR))
  assert.equal(shoreRoute(kelpy).dir, null, 'standing on kelp is still being in water')
})

t('a spot with no headroom is not shore', () => {
  const capped = world((x, y) => {
    if (x >= 5) return y <= 62 ? DIRT : DIRT        // solid all the way up
    return y <= 62 ? WATER : AIR
  })
  assert.equal(shoreRoute(capped).dir, null, 'a bot cannot stand where its head would be inside rock')
})

// --- the steering decision, which is where the bug actually lived -----------
const route = { dir: 'up', target: V(0, 63, 0), dist: 1 }
const shore = { dir: 'shore', target: V(5, 62, 0), dist: 5 }

t('while losing air, it still goes UP and does not chase land', () => {
  // A bot that drowns on its way to a beach is not rescued.
  const c = drowningControls({ losing: true, ashore: false, route, shore })
  assert.equal(c.phase, 'up')
  assert.equal(c.forward, false)
  assert.equal(c.jump, true)
})

t('an air pocket sideways is still swum toward while losing air', () => {
  const c = drowningControls({ losing: true, ashore: false,
                               route: { dir: 'out', target: V(3, 62, 0), dist: 3 }, shore })
  assert.equal(c.phase, 'to_air')
  assert.equal(c.forward, true)
})

t('BREATHING BUT NOT ASHORE NOW SWIMS TO LAND', () => {
  // The phase that did not exist. Previously this returned forward=false and
  // the bot held position at the surface until the ceiling expired.
  const c = drowningControls({ losing: false, ashore: false, route, shore })
  assert.equal(c.phase, 'to_shore')
  assert.equal(c.forward, true, 'holding still here is what produced 2,113 timeouts')
  assert.equal(c.jump, true, 'jump is what gets it up a one-block bank')
  assert.equal(c.lookAt, shore.target)
})

t('breathing with no shore holds the head up rather than thrashing', () => {
  const c = drowningControls({ losing: false, ashore: false, route, shore: { dir: null } })
  assert.equal(c.phase, 'no_shore')
  assert.equal(c.forward, false)
  assert.equal(c.jump, true)
})

t('ashore ends it and releases the controls', () => {
  const c = drowningControls({ losing: false, ashore: true, route, shore })
  assert.equal(c.phase, 'done')
  assert.equal(c.forward, false)
  assert.equal(c.jump, false)
})

t('breathableRoute is UNCHANGED -- the cave contract still holds', () => {
  // The fix must not regress the flooded-cave case, where air genuinely is the
  // exit and drowning-cave.test.mjs asserts 'up'.
  const r = breathableRoute(lakeWithBank)
  assert.equal(r.dir, 'up', 'a bot under a surface must still be told to surface')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
