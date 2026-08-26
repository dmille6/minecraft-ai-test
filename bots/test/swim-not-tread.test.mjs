// TREADING WATER WAS THE LARGEST KILLER IN THE PROJECT.
//
// `drowningControls` phase 2 -- breathing, not ashore, no bank within the scan
// radius -- returned `forward: false`. Hold the head up, let the ownership
// ceiling expire "honestly", which is what open ocean was assumed to look
// like. Twenty-two days of data say otherwise. One six-hour window:
//
//     _drowning_escaped              1,054   reached land
//     _drowning_no_shore             4,295   treaded, then dropped
//     _drowning_reentry              4,185   came straight back
//     _drowning_surfaced_stranded    2,271
//     _drowning_released_timeout     1,955
//
// 1,054 rescues that held against 8,521 that did not. 17 of 19 drowning deaths
// in six hours came AFTER a release, median 46s later, 41% within 30s. And 58
// of 61 carried "idle at the moment of death" -- the runner owned nothing, so
// nothing was swimming.
//
// The diagnosis is architectural and it is the owner's: swimming is a MODE OF
// MOVEMENT, not an emergency. Treading water spends the entire ownership
// ceiling going nowhere and then hands an unowned body back to a cognitive
// loop that will not act for another thirty seconds -- in water.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { drowningControls } from '../src/reflex.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const HOME = { x: 355, z: 147 }
const AT = { x: 900, y: 62, z: 900 }

t('THE 4,295: open water with no bank must SWIM, not tread', () => {
  const c = drowningControls({ losing: false, ashore: false, route: null,
                               shore: null, home: HOME, at: AT })
  assert.strictEqual(c.forward, true,
    'still treading water — this is the branch that spends the whole ceiling ' +
    'going nowhere and then drops an unowned body into open water')
  assert.ok(c.lookAt, 'swimming with no bearing is still not going anywhere')
  assert.strictEqual(c.phase, 'swim_home')
})

t('it swims toward the one direction guaranteed to end on land', () => {
  const c = drowningControls({ losing: false, ashore: false, route: null,
                               shore: null, home: HOME, at: AT })
  assert.strictEqual(c.lookAt.x, HOME.x)
  assert.strictEqual(c.lookAt.z, HOME.z)
})

t('a REACHABLE bank still outranks the long swim home', () => {
  // Nearby land is better than a bearing. This must not regress into always
  // swimming home past a beach three blocks away.
  const shore = { dir: 'shore', target: { x: 10, y: 63, z: 10 }, dist: 4 }
  const c = drowningControls({ losing: false, ashore: false, route: null,
                               shore, home: HOME, at: AT })
  assert.strictEqual(c.phase, 'to_shore')
  assert.strictEqual(c.lookAt, shore.target)
})

t('AIR STILL OUTRANKS EVERYTHING — a bot that drowns en route is not rescued', () => {
  const route = { dir: 'out', target: { x: 1, y: 70, z: 1 } }
  const c = drowningControls({ losing: true, ashore: false, route,
                               shore: null, home: HOME, at: AT })
  assert.strictEqual(c.phase, 'to_air',
    'the swim-home bearing has been allowed to preempt surfacing for air')
})

t('ashore is still done, and is not overridden by a bearing', () => {
  const c = drowningControls({ losing: false, ashore: true, route: null,
                               shore: null, home: HOME, at: AT })
  assert.strictEqual(c.phase, 'done')
  assert.strictEqual(c.forward, false)
})

t('with nowhere named to swim to, holding the head up remains the fallback', () => {
  const c = drowningControls({ losing: false, ashore: false, route: null,
                               shore: null, home: null, at: AT })
  assert.strictEqual(c.phase, 'no_shore')
  assert.strictEqual(c.forward, false)
  assert.strictEqual(c.jump, true, 'stopped holding the head up as well')
})

// ---------------------------------------------------------------------------
// THE CLOCK WAS THE REAL LIMIT.
//
// Fixing the bearing bought 8% of the journey. Bots in the no-shore state are
// a median 1,244 blocks from home (p90 1,513); at surface speed that is 565
// seconds. RESCUE_CEILING_MAX_MS is 45. Air only drains while the head is
// submerged and refills at the surface, so a surface swim has no time limit
// in this game -- the ceiling was written for a rescue and makes no sense
// applied to a crossing.
// ---------------------------------------------------------------------------
const reflexSrc = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

t('THE CLOCK: a crossing is exempt from the hard ceiling', () => {
  assert.ok(/if \(travelling\) return stalled/.test(reflexSrc),
    'rescueExpired still ends a crossing on RESCUE_CEILING_MAX_MS — 45 seconds ' +
    'of a 565-second swim, then an unowned body in open water')
})

t('but a STALLED crossing still ends — ownership is earned, not granted', () => {
  // Without this the exemption is a licence to hold the body forever.
  const fn = reflexSrc.slice(reflexSrc.indexOf('const rescueExpired'),
                             reflexSrc.indexOf('const rescueExpired') + 400)
  assert.ok(/stalled/.test(fn), 'no stall check on the travelling path')
  assert.ok(/PROGRESS_STALL_MS/.test(reflexSrc))
})

t('travelling is re-derived per tick, so it cannot latch', () => {
  assert.ok(/travelling = ctl\.phase === 'swim_home'/.test(reflexSrc),
    'travelling is not recomputed from the current phase — a bot that stops ' +
    'swimming would stay exempt from the ceiling forever')
})

t('progress means CLOSING ON THE TARGET, not merely moving', () => {
  assert.ok(/hd < bestHomeDist - 1/.test(reflexSrc),
    'progress is not measured as distance to home decreasing — a bot swimming ' +
    'in circles would keep renewing its own ownership')
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
