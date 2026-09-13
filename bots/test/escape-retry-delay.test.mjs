// A failed, undisplaced entombed attempt backs off under the movement owner (corpus run 6, 2026-09-13).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { escapeRetryDelay } from '../src/reflex.mjs'
let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log(`  PASS  ${name}`) } catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) } }
t('doubles per consecutive failure from the base and caps', () => {
  assert.equal(escapeRetryDelay(0), 0); assert.equal(escapeRetryDelay(1), 30_000); assert.equal(escapeRetryDelay(2), 60_000); assert.equal(escapeRetryDelay(3), 120_000)
  assert.equal(escapeRetryDelay(4), 240_000); assert.equal(escapeRetryDelay(5), 300_000, 'capped at five minutes'); assert.equal(escapeRetryDelay(40), 300_000)
  assert.equal(escapeRetryDelay(2, { base: 1000, cap: 1500 }), 1500)
})
t('WIRED: the failure branch sets the backoff under the flag (source invariant; comments stripped)', () => {
  const src = readFileSync(new URL('../src/reflex.mjs', import.meta.url), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  const m = src.match(/escapeFailures\+\+; if \(config\.reflex\.arbiter\) lastEscapeAt = Date\.now\(\) \+ escapeRetryDelay\(escapeFailures\)/g) || []
  assert.equal(m.length, 1, 'exactly one wiring of the backoff on the failure branch')
  // MUTANT: the wiring removed leaves the bare increment, which the anchor above does not match
  const mutated = src.replace(m[0], 'escapeFailures++')
  assert.equal((mutated.match(/escapeRetryDelay\(escapeFailures\)/g) || []).length, 0, 'the mutant removed the only call')
})
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1)
