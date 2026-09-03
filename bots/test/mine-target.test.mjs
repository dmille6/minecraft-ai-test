// `mine` DESCENDS TO AN ELEVATION. THE MODEL THOUGHT IT DUG ONE BLOCK.
//
// 82,699 vetoes -- 75.6% of every `bad_args` the fleet has produced -- are this
// one misunderstanding. Sampled across 84 bots, of 907 "only digs DOWNWARD"
// refusals: 626 asked for exactly `here - 1`, 74 for `here` itself. Nothing was
// broken. The gate mirrors the skill exactly, and the skill's shallowest possible
// descent puts the target two below the feet.
//
// So these tests pin two things:
//   1. the ceiling is DERIVED from the skill, not invented here, and
//   2. the number the prompt prints is the SAME number the gate enforces.
// A drift between those two is the whole bug class returning.
import assert from 'node:assert'
import test from 'node:test'
import { mineTargetCeiling, mineTargetOk, mineTargetHint, WORLD_FLOOR } from '../src/mining.mjs'

test('the ceiling is the largest y the skill can actually act on', () => {
  // mine proceeds only while `position.y > goalY + 1`, so it needs
  // goalY < hereY - 1. Largest integer strictly below hereY-1.
  assert.equal(mineTargetCeiling(63.0), 61)   // flat ground: y=62 IS correctly refused
  assert.equal(mineTargetCeiling(62.7), 61)   // mid-fall / slab
  assert.equal(mineTargetCeiling(58), 56)
  assert.equal(mineTargetCeiling(208), 206)
})

test('the new ceiling is behaviour-identical to the rule it replaces', () => {
  // The old gate was `y >= here - 1` -> refuse. If these ever disagree on an
  // integer target, this change silently altered admission rather than naming it.
  for (let here = -50; here <= 320; here += 0.5) {
    for (const y of [here - 3, here - 2, here - 1, here, here + 1]) {
      const yi = Math.round(y)
      if (yi < WORLD_FLOOR) continue
      const oldRefuses = yi >= here - 1
      const newRefuses = !mineTargetOk(here, yi)
      assert.equal(newRefuses, oldRefuses,
        `disagreement at here=${here} y=${yi}: old=${oldRefuses} new=${newRefuses}`)
    }
  }
})

test('the exact shape that produced 626 of 907 refusals is still refused', () => {
  // This is NOT a regression to fix. `here - 1` is genuinely unexecutable.
  // Pinning it stops a future "fix" from admitting a proposal the skill will
  // then refuse anyway -- which is how a veto becomes a wasted runner slot.
  assert.equal(mineTargetOk(63, 62), false, 'here-1 must stay refused')
  assert.equal(mineTargetOk(63, 63), false, 'here itself must stay refused')
  assert.equal(mineTargetOk(63, 61), true, 'here-2 is the shallowest real descent')
})

test('bedrock bounds the ceiling and nothing digs past it', () => {
  assert.equal(mineTargetCeiling(-58), WORLD_FLOOR)
  assert.equal(mineTargetOk(63, -60), false, 'below bedrock is not a target')
  assert.equal(mineTargetOk(0, WORLD_FLOOR), true)
})

test('an unknown position imposes no ceiling rather than a false one', () => {
  // A bot mid-respawn has no position. Refusing every mine because we cannot
  // see the bot would be a cheap negative -- the exact failure this repo keeps
  // re-learning.
  assert.equal(mineTargetCeiling(undefined), null)
  assert.equal(mineTargetCeiling(NaN), null)
  assert.equal(mineTargetOk(undefined, 40), true)
})

test('the hint states the same number the gate enforces', () => {
  // The prompt and the gate must not be able to drift. If the hint ever names a
  // y the gate refuses, the model is being told to do something impossible --
  // which is the original bug wearing a helpful face.
  for (const here of [63, 62.7, 100, 12, 208, -50]) {
    const cap = mineTargetCeiling(here)
    const hint = mineTargetHint(here)
    if (cap > WORLD_FLOOR) {
      assert.ok(hint.includes(`y=${cap}`), `hint at here=${here} omits the cap: ${hint}`)
      assert.equal(mineTargetOk(here, cap), true, `hint names y=${cap} but gate refuses it`)
      assert.equal(mineTargetOk(here, cap + 1), false, `cap is not the boundary at here=${here}`)
    }
  }
})

test('at the bottom of the world the hint stops promising a descent', () => {
  const hint = mineTargetHint(-58)
  assert.ok(/bottom of the world/.test(hint), hint)
  assert.ok(!/pass y=/.test(hint), 'must not name a target it cannot honour')
})
