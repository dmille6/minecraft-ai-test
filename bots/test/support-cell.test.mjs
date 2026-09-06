// "UNDERFOOT" IS TWO CONCEPTS AND THE CODE READ ONE CELL FOR BOTH.
//
// `pos.offset(0, -1, 0)` is correct only when the feet sit at an exact integer
// y. A just-closed canary measured `underfoot != support` in 18 of 54 samples
// (33%) for one stuck bot, so this is not an edge case.
//
//   resting on a full block    y=197.0       offset -> 196   correct
//   resting on a slab          y=195.5       offset -> 194   WRONG (skips the slab)
//   float error, really on 196 y=196.99999   offset -> 195   WRONG (one too deep)
//   FALLING                    y=197.4       offset -> 196   the cell below the
//                                            feet, which IS what a falling bot
//                                            wants — but ceil-1 would give 197,
//                                            the cell the feet are in
//
// It is deliberately NOT gated on `bot.entity.onGround`, which is the obvious
// way and the one signal here that cannot be trusted: mineflayer's
// physics.js:418 sets it false on EVERY inbound position packet with no
// reference to the world, and a stuck bot was measured receiving up to 100 of
// those per 10 seconds. The geometry decides instead, and is self-determining.
import assert from 'node:assert'
import test from 'node:test'
import { supportCell } from '../src/reflex.mjs'

const world = (...solid) => ({ solidAt: b => solid.includes(b) })

test('POSITIVE CONTROL: it distinguishes resting from falling', () => {
  assert.equal(supportCell({ y: 197.0, ...world(196) }).resting, true)
  assert.equal(supportCell({ y: 197.4, ...world() }).resting, false)
})

test('THE FOUR STATES, each reading the cell it should', () => {
  const cases = [
    ['resting on a full block', 197.0, [196], 196, true],
    ['resting on a bottom slab', 195.5, [195], 195, true],
    ['float error, really on 196', 196.99999, [196], 196, true],
    ['falling through air', 197.4, [], 196, false],
  ]
  for (const [label, y, solid, want, resting] of cases) {
    const sc = supportCell({ y, ...world(...solid) })
    assert.equal(sc.y, want, `${label}: got ${sc.y}, want ${want}`)
    assert.equal(sc.resting, resting, label)
  }
})

test('...and it beats the old offset in exactly the cases that were wrong', () => {
  const old = y => Math.floor(y - 1)
  // The two partial/float cases: the old read is off by one, the new one is not.
  for (const [y, solid] of [[195.5, 195], [196.99999, 196]]) {
    assert.notEqual(old(y), solid, `POSITIVE CONTROL: offset really was wrong at y=${y}`)
    assert.equal(supportCell({ y, ...world(solid) }).y, solid)
  }
  // And it must NOT change the case that was already right.
  assert.equal(supportCell({ y: 197.0, ...world(196) }).y, old(197.0))
})

test('a bot standing on ANY partial-height block is found', () => {
  // Slabs 0.5, snow layers 0.125 upward, farmland/dirt_path 0.9375,
  // soul_sand 0.875, mud 0.9. Every one of these produces a fractional feet y,
  // and every one of them was skipped by the fixed offset.
  for (const h of [0.5, 0.125, 0.25, 0.875, 0.9, 0.9375]) {
    const y = 64 + h
    assert.equal(supportCell({ y, ...world(64) }).y, 64, `standing at y=${y}`)
    assert.notEqual(Math.floor(y - 1), 64, `POSITIVE CONTROL: offset misses h=${h}`)
  }
})

test('a falling bot gets the cell BELOW its feet, not the one they are in', () => {
  // ceil(197.4)-1 = 197, which is the cell the feet occupy. Breaking or standing
  // on that cell is meaningless for a bot passing through it.
  for (const y of [197.4, 197.9, 197.001]) {
    const sc = supportCell({ y, ...world() })
    assert.equal(sc.y, Math.floor(y) - 1, `y=${y}`)
    assert.equal(sc.resting, false)
  }
})

test('it never consults onGround, because onGround is pinned by network traffic', () => {
  // The signature takes only `y` and `solidAt`. If onGround were an input, a
  // bot receiving position packets would be told it is falling while it stands
  // still — which is exactly the state the stuck bots are in.
  const sc = supportCell({ y: 197.0, ...world(196), onGround: false })
  assert.equal(sc.y, 196, 'a false onGround must not change the answer')
  assert.equal(sc.resting, true)
})

test('bad inputs return null rather than guessing at a cell', () => {
  assert.equal(supportCell({ y: NaN, ...world(1) }), null)
  assert.equal(supportCell({ y: 10 }), null, 'no solidAt')
  assert.equal(supportCell({}), null)
  assert.equal(supportCell(), null)
})
