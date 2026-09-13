// THE LIVELOCK BREAKER HAS TWO RUNGS AND A LATCH, and a failed relocation no longer clears the veto that found it.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { livelockNext, LIVELOCK_MIN_MOVE, LIVELOCK_LATCH_MS } from '../src/cognitive.mjs'
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
  const c = strip(RAW); const i = c.indexOf('async #escape()'); const f = c.slice(i, i + 3000)
  assert.match(f, /withAscentMovements\(\(\) =>\s*this\.runner\.run\('goto'/, 'rung 2 borrows the ascent profile')
  assert.match(f, /trigger: 'livelock_escape_dig'/, 'rung 2 is labelled')
  const clear = f.indexOf('this.admission.clearRepeatWindow()'); const done = f.indexOf("if (next === 'done') {")
  assert.ok(done > 0 && clear > done && clear < f.indexOf('} else {', done), 'clearRepeatWindow lives inside the done branch only')
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
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
