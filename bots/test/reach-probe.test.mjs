// The candidate slate and the hit test, as behaviour.
//
// `gather` guessed reachability from a LOCAL test and was wrong on 28.0% of
// 5,799 attempts across 77 of 80 bots -- 22.3% even among the 73 bots that were
// travelling freely. These are the pure pieces of asking A* instead.
import assert from 'node:assert'
import { candidateSlate, slateHitBy, probeVerdict } from '../src/reachprobe.mjs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  PASS  ${name}`) }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const HERE = { x: 0, y: 64, z: 0 }
const P = (x, y, z) => ({ x, y, z })

// --- the slate ---------------------------------------------------------------

t('nearest first', () => {
  const s = candidateSlate([P(30, 64, 0), P(3, 64, 0), P(10, 64, 0)], HERE)
  assert.deepEqual(s.map(c => c.x), [3, 10, 30])
})

t('bounded, so the O(goals) heuristic stays cheap', () => {
  const many = Array.from({ length: 200 }, (_, i) => P(i + 1, 64, 0))
  assert.equal(candidateSlate(many, HERE).length, 12)
  assert.equal(candidateSlate(many, HERE, { limit: 4 }).length, 4)
  assert.equal(candidateSlate(many, HERE, { limit: 0 }).length, 0)
})

t('far candidates are dropped, not merely ranked last', () => {
  const s = candidateSlate([P(5, 64, 0), P(500, 64, 0)], HERE)
  assert.deepEqual(s.map(c => c.x), [5], 'a block 500 blocks away is not a candidate')
})

t('block coordinates are floor(), never round()', () => {
  // -306.3 floors to -307 and truncates to -306. That one-block slip has
  // already produced a wrong answer in this project twice.
  const s = candidateSlate([P(-306.3, 64.9, -0.5)], HERE, { maxDist: 1000 })
  assert.deepEqual([s[0].x, s[0].y, s[0].z], [-307, 64, -1])
})

t('duplicates collapse after flooring', () => {
  const s = candidateSlate([P(4.2, 64.1, 0.9), P(4.8, 64.7, 0.2)], HERE)
  assert.equal(s.length, 1, 'the same block twice is one candidate')
})

t('junk in does not throw and does not become a candidate', () => {
  assert.deepEqual(candidateSlate(null, HERE), [])
  assert.deepEqual(candidateSlate([P(1, 64, 0)], null), [])
  assert.deepEqual(candidateSlate([P(1, 64, 0)], { x: NaN, y: 1, z: 1 }), [])
  assert.equal(candidateSlate([null, undefined, {}, P(1, 64, 0)], HERE).length, 1)
})

// --- the hit test, using the library's own adjacency definition ---------------

t('standing orthogonally beside a block counts', () => {
  const slate = candidateSlate([P(10, 64, 0)], HERE)
  for (const n of [P(9, 64, 0), P(11, 64, 0), P(10, 64, 1), P(10, 64, -1)]) {
    assert.ok(slateHitBy(n, slate), `${n.x},${n.y},${n.z} is adjacent`)
  }
})

t('standing ON TOP of the block counts -- the old local test missed this', () => {
  const slate = candidateSlate([P(10, 64, 0)], HERE)
  assert.ok(slateHitBy(P(10, 65, 0), slate), 'approach from above is legal and was not checked')
})

t('two blocks away does not count', () => {
  const slate = candidateSlate([P(10, 64, 0)], HERE)
  assert.equal(slateHitBy(P(12, 64, 0), slate), null)
  assert.equal(slateHitBy(P(11, 65, 0), slate), null, 'diagonal is not adjacent')
})

t('it reports WHICH candidate was reached', () => {
  const slate = candidateSlate([P(5, 64, 0), P(20, 64, 0)], HERE)
  assert.equal(slateHitBy(P(19, 64, 0), slate).x, 20)
  assert.equal(slateHitBy(P(6, 64, 0), slate).x, 5)
})

t('an unusable end node is null, not a false hit', () => {
  const slate = candidateSlate([P(5, 64, 0)], HERE)
  assert.equal(slateHitBy(null, slate), null)
  assert.equal(slateHitBy(P(5, 64, 0), null), null)
})

// --- the verdict, which is the string the model reads ------------------------

t('noPath is a decision: nothing is reachable', () => {
  const v = probeVerdict({ status: 'noPath', checked: 12, nearest: 7.4 })
  assert.equal(v.reachable, false)
  assert.match(v.why, /none of the 12 nearest/)
  assert.match(v.why, /7 blocks away/)
})

t('a timeout is NOT a decision, and must not read as one', () => {
  // Reporting "unreachable" for "I ran out of thinking time" is the exact
  // conflation this codebase already fixed once for collect budget vs no_path.
  for (const status of ['timeout', 'partial']) {
    const v = probeVerdict({ status, checked: 12 })
    assert.equal(v.reachable, null, `${status} must be undecided, never false`)
    assert.match(v.why, /could not decide/)
  }
})

t('success says reachable and offers no excuse', () => {
  const v = probeVerdict({ status: 'success', checked: 12 })
  assert.equal(v.reachable, true)
  assert.equal(v.why, null)
})

t('an unknown status is undecided, not a refusal', () => {
  assert.equal(probeVerdict({ status: 'wat' }).reachable, null)
  assert.equal(probeVerdict({}).reachable, null)
})

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
