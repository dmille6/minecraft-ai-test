// THE GOAL THAT NEVER ENDS AND NEVER ERRORS.
//
// mineflayer-pathfinder 2.4.5 latches `pathUpdated` after one failed recompute
// and then returns from every tick with an empty path and the goal still set.
// Upstream issue #273 records that this state emits NOTHING -- no error, no
// goal_reached, no path_update, no path_reset -- which is why detection has to be
// position-based and why our telemetry never saw it despite _path_reset running
// at ~95/bot-hour and goto succeeding on ~34% of 943 attempts.
//
// The whole risk of this watchdog is false positives: the pathfinder legitimately
// stands still while digging, placing, equipping, and during a search that has
// only just begun. Clearing a goal in those states aborts valid work. Most of
// these tests are about NOT firing.
import assert from 'node:assert'
import { pathfinderWedged, stillnessMs } from '../src/path-watchdog.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const base = { hasGoal: true, moving: false, mining: false, building: false, stillFor: 10000 }

t('the wedged state is detected', () => {
  assert.equal(pathfinderWedged(base), true)
})

t('a moving bot is never wedged', () => {
  // isMoving() is literally `path.length > 0`, so this is the direct read of
  // "the pathfinder still has somewhere to go".
  assert.equal(pathfinderWedged({ ...base, moving: true }), false)
})

t('a DIGGING bot is not wedged, however still it is', () => {
  assert.equal(pathfinderWedged({ ...base, mining: true }), false,
    'clearing the goal mid-dig aborts valid destructive work')
})

t('a PLACING bot is not wedged', () => {
  assert.equal(pathfinderWedged({ ...base, building: true }), false,
    'scaffolding holds position between placements')
})

t('no goal means nothing to clear', () => {
  assert.equal(pathfinderWedged({ ...base, hasGoal: false }), false)
})

t('a brief pause is not a wedge', () => {
  // A search that has only just started has an empty path for a moment. Firing
  // on a single sample would abort goals before they ever computed.
  assert.equal(pathfinderWedged({ ...base, stillFor: 500 }), false)
  assert.equal(pathfinderWedged({ ...base, stillFor: 5999 }), false)
  assert.equal(pathfinderWedged({ ...base, stillFor: 6000 }), true)
})

// --- stillness is 3D, and that is not a detail ------------------------------

t('vertical-only movement counts as moving', () => {
  // THE MISTAKE THIS PREVENTS: a horizontal-only test calls a pillaring or
  // down-mining bot "stuck". It nearly cost a working bot its place in the
  // exposure denominator earlier today, caught only because the control bot in
  // that check had climbed 6 blocks while moving 0.00 horizontally.
  const now = 10000
  const climbing = [
    { x: 0, y: 60, z: 0, t: 1000 },
    { x: 0, y: 63, z: 0, t: 5000 },
    { x: 0, y: 66, z: 0, t: 9000 },
  ]
  // NOT exactly 0: the last sample was 1s ago and we cannot claim knowledge of
  // that gap, so 1000ms is the honest answer. What matters is that a climbing
  // bot never accumulates enough stillness to be called wedged.
  const still = stillnessMs(climbing, now)
  assert.ok(still < 6000,
    `a climbing bot accumulated ${still}ms of stillness — it would be declared wedged`)
  assert.equal(pathfinderWedged({ ...base, stillFor: still }), false)
})

t('a genuinely motionless bot accumulates stillness', () => {
  const now = 10000
  const frozen = [
    { x: 5, y: 62, z: 5, t: 1000 },
    { x: 5, y: 62, z: 5, t: 5000 },
    { x: 5.1, y: 62, z: 5, t: 9000 },   // sub-threshold jitter
  ]
  assert.ok(stillnessMs(frozen, now) >= 9000,
    `expected >=9s of stillness, got ${stillnessMs(frozen, now)}`)
})

t('too few samples is not evidence of stillness', () => {
  assert.equal(stillnessMs([], 1000), 0)
  assert.equal(stillnessMs([{ x: 0, y: 0, z: 0, t: 0 }], 1000), 0,
    'one sample cannot establish that a bot has not moved')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
