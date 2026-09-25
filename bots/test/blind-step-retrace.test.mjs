// The blind step's RETRACE candidate, tested as behaviour.
//
// blindstep-01 appended `ang + Math.PI` and called it "the line just travelled". It was not:
// `ang` is an exploration bearing that is RANDOM when the target is near, and nothing recorded
// where the bot had been. A trail is now kept in index.mjs; these cases pin what is done with it.
import test from 'node:test'
import assert from 'node:assert'
import { retraceHeading, stepCandidates } from '../src/skills.mjs'

// prismarine-physics applies heading as x = -sin(yaw), z = -cos(yaw).
const unit = (ang) => ({ x: -Math.sin(ang), z: -Math.cos(ang) })
const P = { x: 100, y: 64, z: 200 }

test('no trail -> no heading, and therefore no fifth candidate', () => {
  for (const c of [[], null, undefined]) assert.equal(retraceHeading(P, c), null)
  assert.equal(stepCandidates(1, 0.3, retraceHeading(P, [])).length, 4,
    'an absent trail must NOT silently become a random heading')
})

test('a crumb closer than minDist is skipped -- a 1.2 s walk would go nowhere', () => {
  assert.equal(retraceHeading(P, [{ x: 101, y: 64, z: 200 }]), null)
  assert.equal(retraceHeading(P, [{ x: 102.9, y: 64, z: 200 }]), null)
  assert.notEqual(retraceHeading(P, [{ x: 103.1, y: 64, z: 200 }]), null)
})

test('THE CONVENTION: the heading really points at the crumb, on all four axes', () => {
  const cases = [
    [{ x: 100, z: 210 }, { x: 0, z: 1 }],
    [{ x: 100, z: 190 }, { x: 0, z: -1 }],
    [{ x: 110, z: 200 }, { x: 1, z: 0 }],
    [{ x: 90, z: 200 }, { x: -1, z: 0 }],
  ]
  for (const [c, want] of cases) {
    const ang = retraceHeading(P, [{ ...c, y: 64 }])
    const u = unit(ang)
    assert.ok(Math.hypot(u.x - want.x, u.z - want.z) < 1e-9,
      `crumb at ${c.x},${c.z}: heading points (${u.x.toFixed(3)},${u.z.toFixed(3)}), want (${want.x},${want.z})`)
  }
})

test('the NEWEST qualifying crumb wins, not the nearest or the oldest', () => {
  const crumbs = [{ x: 90, y: 64, z: 200 }, { x: 100, y: 64, z: 210 }]   // oldest first
  const u = unit(retraceHeading(P, crumbs))
  assert.ok(Math.hypot(u.x - 0, u.z - 1) < 1e-9, 'must aim at the LAST entry (+z), not the first')
})

test('...but it falls back past a too-close newest crumb to an older valid one', () => {
  const crumbs = [{ x: 90, y: 64, z: 200 }, { x: 100.5, y: 64, z: 200 }]
  const u = unit(retraceHeading(P, crumbs))
  assert.ok(Math.hypot(u.x - (-1), u.z - 0) < 1e-9, 'newest is 0.5 blocks away; use the -x one')
})

test('malformed crumbs are skipped, not crashed on', () => {
  const crumbs = [{ x: 90, y: 64, z: 200 }, null, { x: NaN, z: 5 }, { z: 9 }]
  const u = unit(retraceHeading(P, crumbs))
  assert.ok(Math.hypot(u.x - (-1), u.z - 0) < 1e-9)
})

test('the retrace is LAST, so a bot with any forward line never reaches it', () => {
  const c = stepCandidates(1.0, 0.4, 2.5)
  assert.equal(c.length, 5)
  assert.deepEqual(c.map(x => x[1]), ['heading', 'turn', 'perp+', 'perp-', 'retrace'])
  assert.equal(c[4][0], 2.5)
})

test('a non-finite retrace gives four candidates, not a NaN heading into bot.look', () => {
  for (const bad of [NaN, Infinity, -Infinity, null, undefined, 'x']) {
    assert.equal(stepCandidates(1, 0.3, bad).length, 4, `retrace=${String(bad)}`)
  }
})

test('the four forward candidates are untouched by any of this', () => {
  const ang = 1.0, turn = 0.4
  assert.deepEqual(stepCandidates(ang, turn, 2.5).slice(0, 4).map(x => x[0]),
    [ang, ang - 2 * turn, ang + Math.PI / 2, ang - Math.PI / 2])
})
