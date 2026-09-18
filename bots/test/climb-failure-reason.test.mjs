// climbFailureReason: the three ways a pillar ends with no height, told apart. See the note above the function.
import assert from 'node:assert/strict'
import { climbFailureReason } from '../src/reflex.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }

t('no floor under the bot names itself and the step it happened on, ahead of every other reason', () => {
  assert.equal(climbFailureReason({ noFloorAt: 0, placed: 5, stalled: 9 }), 'no_floor_at_0')
  assert.equal(climbFailureReason({ noFloorAt: 7 }), 'no_floor_at_7')
})
t('placing and sliding back is distinguishable from never placing at all', () => {
  const never = climbFailureReason({ placed: 0, steps: 8, stalled: 0 })
  const slid = climbFailureReason({ placed: 6, steps: 8, stalled: 0 })
  assert.match(never, /placed=0/); assert.match(slid, /placed=6/)
  assert.notEqual(never, slid, 'these are different bugs and the row must not conflate them')
})
t('three stalls is its own exit, and carries how far the climb got', () => {
  assert.equal(climbFailureReason({ placed: 2, steps: 4, stalled: 3 }), 'stalled_at_4 placed=2')
  assert.match(climbFailureReason({ placed: 2, steps: 4, stalled: 2 }), /^no_gain/, 'under the threshold it is not a stall')
})
t('every reason is a short single-line token the row can carry', () => {
  for (const a of [{ noFloorAt: 1 }, { stalled: 3, steps: 2 }, { placed: 1, steps: 2 }]) {
    const r = climbFailureReason(a)
    assert.ok(r.length <= 48 && !/\n/.test(r), `bad row token: ${r}`)
  }
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
