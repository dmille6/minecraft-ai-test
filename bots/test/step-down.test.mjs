// THE GUARD NOTICED A DROP AND NEVER MEASURED IT.
//
// `mine`'s descent guard probed three blocks, saw air, and refused: "that is a
// fall, not a stair". Correct in origin -- a staircase breaking into a cave roof
// used to drop the bot however deep the cave was. But it could not tell a
// 4-block step-down (ONE damage point) from a 118-block void, and refused both.
//
// A bot marooned on a pillar is surrounded by open space BY DEFINITION, so this
// guard was the third wall of a three-guard trap:
//   1. escape reflex -> "gather 8 blocks to pillar out"
//   2. gather         -> "dirt is 27 blocks away and unreachable"
//   3. mine           -> "open space below"
// Fifteen of eighty bots. ~5,800 decisions in five hours. Two successes.
//
// Measured 2026-09-03 over 24h: of 31 `mine` calls by bots above y=90, twelve
// stopped on this guard. board-c-Alpha sat at y=94 with terrain at y=62-90 --
// a four-block drop to safety, holding three pickaxes, refused indefinitely.
import assert from 'node:assert'
import test from 'node:test'
import { survivableDrop, mayStepDown, FALL_FREE } from '../src/mining.mjs'

test('fall damage is priced the way the game prices it', () => {
  // Minecraft: `blocks - 3` damage points, 20 points kills. The default margin
  // of 6 leaves three hearts, so the cap is 20 - 6 + 3 = 17.
  assert.equal(FALL_FREE, 3)
  assert.equal(survivableDrop(20), 17)
  assert.equal(survivableDrop(10), 7)
  assert.equal(survivableDrop(20, 0), 23, 'with no margin, 23 blocks is the lethal edge')
})

test('a hurt bot is allowed less, and a nearly-dead one nothing', () => {
  assert.ok(survivableDrop(8) < survivableDrop(20))
  assert.equal(survivableDrop(6), 0, 'at the margin, refuse every drop')
  assert.equal(survivableDrop(2), 0)
  assert.equal(survivableDrop(undefined), 17, 'unknown health assumes full, as the gate does')
})

test('THE REAL CASE: board-c-Alpha, y=94, four blocks above terrain', () => {
  // This bot held three pickaxes and zero placeable blocks, and was refused for
  // five hours over a drop that costs one damage point.
  assert.equal(mayStepDown(4, 20, false), true, 'a 4-block drop must be allowed')
  assert.equal(mayStepDown(4, 20, false) && survivableDrop(20) >= 4, true)
})

test('a genuine void is still refused -- this is what the guard is FOR', () => {
  assert.equal(mayStepDown(118, 20, false), false, 'the y=208 case is lethal')
  assert.equal(mayStepDown(18, 20, false), false, 'one past the cap')
  assert.equal(mayStepDown(24, 20, false), false)
})

test('an UNMEASURED drop is refused, not guessed at', () => {
  // null means "deeper than we probed". The whole point is to stop guessing.
  assert.equal(mayStepDown(null, 20, false), false)
  assert.equal(mayStepDown(undefined, 20, false), false)
})

test('holding blocks makes the guard STRICTER, never looser', () => {
  // A bot that can build should build. Falling 17 blocks to save placing one is
  // 14 damage spent for nothing.
  for (const d of [4, 8, 17]) {
    assert.equal(mayStepDown(d, 20, true), false, `depth ${d} with scaffold must build, not fall`)
    assert.equal(mayStepDown(d, 20, false), true, `depth ${d} without scaffold may step down`)
  }
  // An ordinary stair tread is fine either way.
  assert.equal(mayStepDown(1, 20, true), true)
  assert.equal(mayStepDown(FALL_FREE, 20, true), true, 'a free-fall-height drop costs nothing')
})

test('ordinary staircase treads are unaffected', () => {
  // The guard only ever fired at hollow >= 3; one- and two-block steps are the
  // normal case and must not change behaviour.
  assert.equal(mayStepDown(0, 20, false), true)
  assert.equal(mayStepDown(1, 20, false), true)
  assert.equal(mayStepDown(1, 20, true), true)
})

test('the allowed depth never exceeds what health can pay', () => {
  // Property: for any health, the deepest allowed drop must leave the bot alive
  // with the margin intact.
  for (let hp = 1; hp <= 20; hp++) {
    const cap = survivableDrop(hp)
    if (cap === 0) { assert.equal(mayStepDown(2, hp, false), false, `hp ${hp} must refuse`); continue }
    assert.equal(mayStepDown(cap, hp, false), true, `hp ${hp} should allow its own cap ${cap}`)
    assert.equal(mayStepDown(cap + 1, hp, false), false, `hp ${hp} must refuse cap+1`)
    const damage = Math.max(0, cap - FALL_FREE)
    assert.ok(hp - damage >= 6 - 1e-9, `hp ${hp}: cap ${cap} would leave ${hp - damage}`)
  }
})
