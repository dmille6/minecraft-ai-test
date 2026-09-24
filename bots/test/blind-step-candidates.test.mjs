// The blind step's candidate ORDER, tested as behaviour rather than grepped as text.
//
// WHY THIS FILE EXISTS. The order used to be pinned by matching the literal array in
// skills.mjs, which is exactly what this repo's rules forbid: it broke when the LIST changed
// rather than when the DECISION changed, and it could not have told the difference.
//
// WHAT THE DECISION IS. Measured 2026-09-24 over 479 measured bot-hours: blind-step refusals
// run at 10.70/bot-h and 69.7% of the rows sit in a burst of FOUR OR MORE -- every candidate
// refused. The loop then sleeps 300 ms WITHOUT MOVING, so the next pass stands on the same
// block, samples the same terrain and refuses identically; bursts of 5 and 6+ are that
// repeating at one coordinate for up to 62 s, and 26.7% of all refusals are at a coordinate
// the same bot had already been refused at five or more times.
//
// The fix is a fifth candidate, the REVERSE, and it must be LAST.
import test from 'node:test'
import assert from 'node:assert'
import { stepCandidates } from '../src/skills.mjs'

const NAMES = ['heading', 'turn', 'perp+', 'perp-', 'reverse']

test('five candidates, named, in a fixed order', () => {
  const c = stepCandidates(1.0, 0.4)
  assert.equal(c.length, 5)
  assert.deepEqual(c.map(x => x[1]), NAMES)
})

test('the REVERSE is LAST, so a bot with any forward line never reaches it', () => {
  for (const [ang, turn] of [[0, 0.1], [1.0, 0.4], [-2.5, -0.7], [Math.PI, 0.0]]) {
    const c = stepCandidates(ang, turn)
    assert.equal(c[c.length - 1][1], 'reverse',
      `reverse must be last for ang=${ang} turn=${turn}`)
    assert.equal(c.findIndex(x => x[1] === 'reverse'), 4)
  }
})

test('the reverse really is the opposite direction, within a float tick', () => {
  for (const ang of [0, 0.7, -1.3, Math.PI / 3, 2 * Math.PI]) {
    const rev = stepCandidates(ang, 0.2).find(x => x[1] === 'reverse')[0]
    // opposite means the unit vectors sum to zero; comparing angles modulo 2pi is the bug farm
    const dx = -Math.sin(ang) + -Math.sin(rev)
    const dz = -Math.cos(ang) + -Math.cos(rev)
    assert.ok(Math.hypot(dx, dz) < 1e-12, `ang=${ang} rev=${rev} is not opposite (${dx},${dz})`)
  }
})

test('the FIRST candidate is the heading untouched -- the common path is unchanged', () => {
  for (const ang of [0, 1.0, -2.2]) {
    assert.equal(stepCandidates(ang, 0.9)[0][0], ang)
    assert.equal(stepCandidates(ang, 0.9)[0][1], 'heading')
  }
})

test('the four forward candidates are unchanged from the version this replaces', () => {
  const ang = 1.0, turn = 0.4
  const got = stepCandidates(ang, turn).slice(0, 4).map(x => x[0])
  assert.deepEqual(got, [ang, ang - 2 * turn, ang + Math.PI / 2, ang - Math.PI / 2],
    'adding the reverse must not have moved the four that were already there')
})

test('every candidate is a finite number -- a NaN heading would make bot.look throw', () => {
  for (const [ang, turn] of [[0, 0], [Math.PI, -0.5], [-Math.PI, 1.7]]) {
    for (const [c, n] of stepCandidates(ang, turn)) {
      assert.ok(Number.isFinite(c), `${n} is not finite for ang=${ang} turn=${turn}`)
    }
  }
})
