// THE LIVELOCK BREAKER HAS TWO RUNGS AND A LATCH, and a failed relocation no longer clears the veto that found it.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { livelockNext, escapedFrom, ladderExhausted, LIVELOCK_MIN_MOVE, LIVELOCK_LATCH_MS, LADDER_MAX_LATCHES } from '../src/cognitive.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const RAW = readFileSync(new URL('../src/cognitive.mjs', import.meta.url), 'utf8')

t('walk that moved -> done; walk that did not -> dig; dig that did not -> latch', () => {
  assert.equal(livelockNext({ rung: 'walk', moved: 30 }), 'done')
  assert.equal(livelockNext({ rung: 'walk', moved: 0 }), 'dig')
  assert.equal(livelockNext({ rung: 'walk', moved: LIVELOCK_MIN_MOVE - 0.1 }), 'dig')
  assert.equal(livelockNext({ rung: 'dig', moved: 12 }), 'done')
  assert.equal(livelockNext({ rung: 'dig', moved: 0 }), 'latch')
  assert.ok(LIVELOCK_LATCH_MS >= 300_000, 'the rest is minutes, not seconds')
})
t('the escape runs the dig rung under the ascent profile, and only clears the repeat window on `done`', () => {
  const c = strip(RAW); const i = c.indexOf('async #escape()'); const f = c.slice(i, i + 6000)
  assert.match(f, /withAscentMovements\(\(\) =>\s*this\.runner\.run\('goto'/, 'rung 2 borrows the ascent profile')
  assert.match(f, /trigger: 'livelock_escape_dig'/, 'rung 2 is labelled')
  const clear = f.indexOf('this.admission.clearRepeatWindow()'); const done = f.indexOf("if (next === 'done') {")
  const ret = f.indexOf('return', done)
  assert.ok(done > 0 && clear > done && clear < ret, 'clearRepeatWindow lives inside the done branch only')
  assert.equal(f.lastIndexOf('this.admission.clearRepeatWindow()'), clear, 'no second clear after the done branch')
  assert.match(f, /this\.livelockLatchedUntil = Date\.now\(\) \+ LIVELOCK_LATCH_MS/, 'a failed ladder latches')
  assert.match(c, /if \(!\(this\.livelockLatchedUntil > Date\.now\(\)\)\) await this\.#escape\(\)/, 'the trigger honours the latch')
})
t('MUTANT: clearing the window unconditionally again is caught', () => {
  const c = strip(RAW); const anchor = "if (next === 'done') {\n      this.admission.clearRepeatWindow()"
  assert.equal(c.split(anchor).length - 1, 1, 'ANCHOR MISSING or not unique')
  const bad = c.replace(anchor, "this.admission.clearRepeatWindow()\n    if (next === 'done') {")
  const i = bad.indexOf('async #escape()'); const f = bad.slice(i, i + 3000)
  const clear = f.indexOf('this.admission.clearRepeatWindow()'); const done = f.indexOf("if (next === 'done') {")
  assert.ok(clear < done, 'the mutant clears before the branch, which the real test must catch')
})

t('the shared postcondition: eight blocks sideways, or four blocks up into DRY air; height gained into water is not an escape', () => {
  const from = { x: 0, y: 55, z: 0 }
  assert.equal(escapedFrom(from, { x: 9, y: 55, z: 0, wet: false }), true)
  assert.equal(escapedFrom(from, { x: 3, y: 55, z: 3, wet: false }), false)
  assert.equal(escapedFrom(from, { x: 0, y: 60, z: 0, wet: false }), true, 'a pillar or shaft that gained 5 dry blocks')
  assert.equal(escapedFrom(from, { x: 0, y: 60, z: 0, wet: true }), false, 'the same rise into water (hive-a-Delta reached y=63 swimming)')
  assert.equal(escapedFrom(from, null), false)
})
t('three latches inside an hour exhaust the ladder; an old latch does not count', () => {
  const now = 10_000_000
  assert.equal(ladderExhausted([now - 100, now - 200], now), false)
  assert.equal(ladderExhausted([now - 100, now - 200, now - 300], now), true)
  assert.equal(ladderExhausted([now - 4_000_000, now - 200, now - 300], now), false, 'the first latch fell out of the window')
  assert.equal(LADDER_MAX_LATCHES, 3)
})
t('the escape declares recovery_exhausted exactly when the ladder is exhausted, and rests longer', () => {
  const c = strip(RAW); const i = c.indexOf('async #escape()'); const f = c.slice(i, i + 5000)
  assert.match(f, /if \(ladderExhausted\(this\.livelockLatches, Date\.now\(\)\)\) \{[\s\S]{0,600}kind: 'recovery_exhausted'/, 'the terminal event')
  assert.match(f, /this\.livelockLatchedUntil = Date\.now\(\) \+ LADDER_EXHAUSTED_REST_MS/, 'the long rest')
  assert.match(f, /escapedFrom\(from, here\(\)\) \? 'done'/, 'done is the shared postcondition, not raw displacement')
  assert.match(f, /blocks spent \$\{spent\}/, 'the spend is reported')
})

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
